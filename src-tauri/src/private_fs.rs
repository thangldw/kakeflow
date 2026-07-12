// Operating-system access controls for KakeFlow's private application data.
//
// Encryption protects data at rest, while these controls prevent other local
// users from opening or replacing application files. Windows DACLs are
// protected from inheritance and grant full control only to the object owner,
// Local System, and the local Administrators group.

use std::io;
use std::path::Path;

pub(crate) fn secure_directory(path: &Path) -> io::Result<()> {
    secure_path(path, PathKind::Directory)
}

pub(crate) fn secure_file(path: &Path) -> io::Result<()> {
    secure_path(path, PathKind::File)
}

/// Re-applies private ACLs to a tree created by an older KakeFlow release.
/// Symlinks and special files are rejected instead of followed, preventing an
/// ACL migration from escaping the application-controlled directory.
#[cfg(target_os = "windows")]
pub(crate) fn secure_tree(path: &Path) -> io::Result<()> {
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "private data tree contains a symlink",
        ));
    }
    if metadata.is_file() {
        return secure_file(path);
    }
    if !metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "private data tree contains a special file",
        ));
    }

    secure_directory(path)?;
    for entry in std::fs::read_dir(path)? {
        secure_tree(&entry?.path())?;
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum PathKind {
    Directory,
    File,
}

#[cfg(unix)]
fn secure_path(path: &Path, kind: PathKind) -> io::Result<()> {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    let mode = match kind {
        PathKind::Directory => 0o700,
        PathKind::File => 0o600,
    };
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(target_os = "windows")]
fn secure_path(path: &Path, kind: PathKind) -> io::Result<()> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    use windows_sys::Win32::Foundation::{GetLastError, LocalFree};
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{
        SetFileSecurityW, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
        PSECURITY_DESCRIPTOR,
    };

    let mut path_wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    if path_wide.contains(&0) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "path contains a NUL character",
        ));
    }
    path_wide.push(0);

    let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
    let sddl = sddl(kind);
    let converted = unsafe {
        // SAFETY: `sddl` is NUL-terminated and remains alive for the call. The
        // API initializes `descriptor`, which is released with LocalFree.
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            ptr::null_mut(),
        )
    };
    if converted == 0 {
        return Err(io::Error::from_raw_os_error(
            unsafe { GetLastError() } as i32
        ));
    }

    let applied = unsafe {
        // SAFETY: both pointers are valid NUL-terminated/allocated values for
        // the duration of the call. Only the descriptor's DACL is applied.
        SetFileSecurityW(
            path_wide.as_ptr(),
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            descriptor,
        )
    };
    let error = if applied == 0 {
        Some(io::Error::from_raw_os_error(
            unsafe { GetLastError() } as i32
        ))
    } else {
        None
    };
    unsafe {
        // SAFETY: the descriptor was allocated by LocalAlloc inside the
        // conversion API and has not previously been freed.
        LocalFree(descriptor.cast::<c_void>());
    }
    error.map_or(Ok(()), Err)
}

#[cfg(target_os = "windows")]
fn sddl(kind: PathKind) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;

    // D:P prevents a broader parent DACL from being inherited. OW is the
    // Windows OWNER RIGHTS well-known SID; OICI propagates the directory ACL
    // to future files and subdirectories.
    let value = match kind {
        PathKind::Directory => "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;OW)",
        PathKind::File => "D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;OW)",
    };
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(not(any(unix, target_os = "windows")))]
fn secure_path(_path: &Path, _kind: PathKind) -> io::Result<()> {
    Ok(())
}

#[cfg(all(test, target_os = "windows"))]
mod windows_tests {
    use super::*;

    fn decoded(kind: PathKind) -> String {
        let encoded = sddl(kind);
        assert_eq!(encoded.last(), Some(&0));
        String::from_utf16(&encoded[..encoded.len() - 1]).expect("valid SDDL UTF-16")
    }

    #[test]
    fn file_acl_is_protected_and_owner_only() {
        assert_eq!(
            decoded(PathKind::File),
            "D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;OW)"
        );
    }

    #[test]
    fn directory_acl_propagates_to_children() {
        let descriptor = decoded(PathKind::Directory);
        assert!(descriptor.starts_with("D:P"));
        assert_eq!(descriptor.matches("OICI").count(), 3);
    }
}
