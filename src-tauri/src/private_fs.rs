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

fn secure_path(path: &Path, kind: PathKind) -> io::Result<()> {
    let metadata = std::fs::symlink_metadata(path)?;
    let matches_kind = match kind {
        PathKind::Directory => metadata.file_type().is_dir(),
        PathKind::File => metadata.file_type().is_file(),
    };
    if metadata.file_type().is_symlink() || !matches_kind {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "private path has an unexpected filesystem type",
        ));
    }
    apply_secure_path(path, kind)
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
fn apply_secure_path(path: &Path, kind: PathKind) -> io::Result<()> {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    let mode = match kind {
        PathKind::Directory => 0o700,
        PathKind::File => 0o600,
    };
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(target_os = "windows")]
fn apply_secure_path(path: &Path, kind: PathKind) -> io::Result<()> {
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
fn apply_secure_path(_path: &Path, _kind: PathKind) -> io::Result<()> {
    Ok(())
}

#[cfg(all(test, unix))]
mod unix_tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    #[test]
    fn private_permissions_never_follow_symlinks() {
        let root = std::env::temp_dir().join(format!(
            "kakeflow-private-fs-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let target_directory = root.join("target-directory");
        let target_file = root.join("target-file");
        std::fs::create_dir_all(&target_directory).expect("target directory");
        std::fs::write(&target_file, b"target").expect("target file");
        std::fs::set_permissions(&target_directory, std::fs::Permissions::from_mode(0o755))
            .expect("directory permissions");
        std::fs::set_permissions(&target_file, std::fs::Permissions::from_mode(0o644))
            .expect("file permissions");
        let directory_link = root.join("directory-link");
        let file_link = root.join("file-link");
        symlink(&target_directory, &directory_link).expect("directory symlink");
        symlink(&target_file, &file_link).expect("file symlink");

        assert_eq!(
            secure_directory(&directory_link)
                .expect_err("directory symlink rejected")
                .kind(),
            io::ErrorKind::InvalidData
        );
        assert_eq!(
            secure_file(&file_link)
                .expect_err("file symlink rejected")
                .kind(),
            io::ErrorKind::InvalidData
        );
        assert_eq!(
            std::fs::metadata(&target_directory)
                .expect("directory metadata")
                .permissions()
                .mode()
                & 0o777,
            0o755
        );
        assert_eq!(
            std::fs::metadata(&target_file)
                .expect("file metadata")
                .permissions()
                .mode()
                & 0o777,
            0o644
        );

        std::fs::remove_dir_all(root).expect("cleanup");
    }
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
