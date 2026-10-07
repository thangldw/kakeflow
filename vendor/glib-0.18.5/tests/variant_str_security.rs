use glib::variant::ToVariant;

#[test]
fn ffi_output_is_valid_for_unicode_and_both_directions() {
    let values = ["alpha", "日本語", "", "🦀", "omega"];
    let v = values.to_variant();
    let mut iter = v.array_iter_str().unwrap();
    assert_eq!(iter.next(), Some("alpha"));
    assert_eq!(iter.next_back(), Some("omega"));
    assert_eq!(iter.next(), Some("日本語"));
    assert_eq!(iter.next_back(), Some("🦀"));
    assert_eq!(iter.next(), Some(""));
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
}

#[test]
fn repeated_native_reads_and_skips_preserve_borrowed_values() {
    let values = ["zero", "one", "two", "three"];
    let v = values.to_variant();
    for _ in 0..1000 {
        let mut iter = v.array_iter_str().unwrap();
        assert_eq!(iter.nth(1), Some("one"));
        assert_eq!(iter.nth_back(0), Some("three"));
        assert_eq!(iter.next(), Some("two"));
        assert_eq!(iter.len(), 0);
        assert_eq!(iter.next(), None);
    }
}
