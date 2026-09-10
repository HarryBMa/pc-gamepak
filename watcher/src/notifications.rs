//! Best-effort cartridge arrival notifications.

#[cfg(windows)]
pub fn cartridge_ready(
    hwnd: windows_sys::Win32::Foundation::HWND,
    title: &str,
    body: &str,
) -> bool {
    use windows_sys::Win32::UI::Shell::{
        NIIF_INFO, NIF_INFO, NIM_MODIFY, NOTIFYICONDATAW, Shell_NotifyIconW,
    };

    let mut data: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
    data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
    data.hWnd = hwnd;
    data.uID = crate::tray::ICON_ID;
    data.uFlags = NIF_INFO;
    data.dwInfoFlags = NIIF_INFO;

    write_wide(&mut data.szInfoTitle, title);
    write_wide(&mut data.szInfo, body);

    unsafe { Shell_NotifyIconW(NIM_MODIFY, &data) != 0 }
}

#[cfg(windows)]
fn write_wide(buffer: &mut [u16], text: &str) {
    if buffer.is_empty() {
        return;
    }
    let wide: Vec<u16> = text.encode_utf16().collect();
    let count = wide.len().min(buffer.len() - 1);
    buffer[..count].copy_from_slice(&wide[..count]);
    buffer[count] = 0;
}

#[cfg(not(windows))]
pub fn cartridge_ready(title: &str, body: &str) -> bool {
    std::process::Command::new("notify-send")
        .arg(title)
        .arg(body)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}
