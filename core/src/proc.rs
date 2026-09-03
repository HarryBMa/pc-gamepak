//! Running a command without a console window flashing up.
//!
//! The launcher and the wizard are built with `windows_subsystem = "windows"`,
//! so they own no console. Windows gives every child process one anyway unless
//! it is told not to — which means a `powershell.exe` used to read a drive's
//! transport, or a `tasklist` used to see whether Steam is running, opens a
//! black window in front of the wizard for as long as it runs.
//!
//! It is not cosmetic. Picking a drive runs three of these, so choosing a
//! cartridge flashed a console at the user for something they never asked to
//! see and cannot act on.
//!
//! Every subprocess in this crate goes through here. On anything but Windows
//! this is `Command::new` with a longer name.

use std::process::Command;

/// `CREATE_NO_WINDOW`. Declared rather than pulled from `windows-sys`, because
/// one constant is not worth a dependency edge in a module this small.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A `Command` that will not open a console window.
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_still_runs_the_program_it_was_given() {
        // The flag must not change what is executed, only how it is displayed.
        let program = if cfg!(windows) { "cmd" } else { "true" };
        let command = command(program);
        assert_eq!(command.get_program(), program);
    }
}
