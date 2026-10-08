//! PC/SC access for writing GamePak NFC cards from the wizard.

#[cfg(any(target_os = "linux", target_os = "windows"))]
use pcsc::{Card, Context, Protocols, Scope, ShareMode};

#[cfg(any(target_os = "linux", target_os = "windows"))]
const MAX_TYPE2_CAPACITY: usize = 1008;

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub fn readers() -> Result<Vec<String>, String> {
    let context = Context::establish(Scope::User)
        .map_err(|error| format!("PC/SC is unavailable: {error}"))?;
    context
        .list_readers_owned()
        .map(|readers| {
            readers
                .into_iter()
                .map(|reader| reader.to_string_lossy().into_owned())
                .collect()
        })
        .map_err(|error| format!("could not list NFC readers: {error}"))
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub fn write_gamepak_card(reader_name: &str, id: &str) -> Result<(), String> {
    let message = gamepak_core::nfc::ndef_uri(id)?;
    let context = Context::establish(Scope::User)
        .map_err(|error| format!("PC/SC is unavailable: {error}"))?;
    let reader = context
        .list_readers_owned()
        .map_err(|error| format!("could not list NFC readers: {error}"))?
        .into_iter()
        .find(|reader| reader.to_string_lossy() == reader_name)
        .ok_or_else(|| "the selected NFC reader is no longer available".to_string())?;
    let card = context
        .connect(&reader, ShareMode::Shared, Protocols::ANY)
        .map_err(|error| format!("could not connect to the NFC card: {error}"))?;
    write_type2(&card, &message)
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn write_type2(card: &Card, message: &[u8]) -> Result<(), String> {
    let cc = exchange(card, &[0xff, 0xb0, 0x00, 0x03, 0x04])?;
    if cc.len() != 4 || cc[0] != 0xe1 {
        return Err("insert a writable, NDEF-formatted Type 2 NFC tag".into());
    }
    if cc[3] & 0x0f != 0 {
        return Err("this NFC tag is write-protected".into());
    }

    let capacity = usize::from(cc[2]) * 8;
    if capacity == 0 || capacity > MAX_TYPE2_CAPACITY {
        return Err("this Type 2 tag has an unsupported memory size".into());
    }
    let page_count = capacity.div_ceil(4);
    let mut memory = Vec::with_capacity(page_count * 4);
    for offset in 0..page_count {
        let page = u8::try_from(offset + 4)
            .map_err(|_| "this Type 2 tag has an unsupported memory size".to_string())?;
        let bytes = exchange(card, &[0xff, 0xb0, 0x00, page, 0x04])?;
        if bytes.len() != 4 {
            return Err("Type 2 page read returned an unexpected length".into());
        }
        memory.extend_from_slice(&bytes);
    }

    let tlv = type2_tlv(message)?;
    let write_len = tlv.len();
    if write_len > capacity {
        return Err("this NFC tag does not have enough space for the GamePak ID".into());
    }

    if !is_blank_type2_memory(&memory) {
        return Err("this NFC tag already contains data; use a blank tag".into());
    }

    for offset in 1..(write_len / 4) {
        write_page(card, 4 + offset, &tlv[offset * 4..offset * 4 + 4])?;
    }
    // Publish the NDEF TLV length last, so a reader cannot observe a partial URI.
    write_page(card, 4, &tlv[..4])?;

    let mut written = Vec::with_capacity(write_len);
    for offset in 0..(write_len / 4) {
        let page = u8::try_from(offset + 4)
            .map_err(|_| "Type 2 page number is out of range".to_string())?;
        written.extend_from_slice(&exchange(card, &[0xff, 0xb0, 0x00, page, 0x04])?);
    }
    if written.get(..write_len) != Some(&tlv) {
        return Err("could not verify the GamePak card after writing".into());
    }
    Ok(())
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn type2_tlv(message: &[u8]) -> Result<Vec<u8>, String> {
    if message.len() > 254 {
        return Err("GamePak URI is too large for an NFC tag".into());
    }
    let mut tlv = Vec::with_capacity(message.len() + 6);
    tlv.extend_from_slice(&[0x03, message.len() as u8]);
    tlv.extend_from_slice(message);
    tlv.push(0xfe);
    tlv.resize(tlv.len().div_ceil(4) * 4, 0);
    Ok(tlv)
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn is_blank_type2_memory(memory: &[u8]) -> bool {
    memory.iter().all(|byte| *byte == 0)
        || (memory.starts_with(&[0x03, 0x00])
            && (memory.get(2) == Some(&0xfe) || memory.get(2) == Some(&0x00))
            && memory
                .get(3..)
                .is_some_and(|rest| rest.iter().all(|byte| *byte == 0)))
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn write_page(card: &Card, page: usize, bytes: &[u8]) -> Result<(), String> {
    let page = u8::try_from(page).map_err(|_| "Type 2 page number is out of range".to_string())?;
    if bytes.len() != 4 {
        return Err("Type 2 pages must contain four bytes".into());
    }
    let mut command = [0u8; 9];
    command[..5].copy_from_slice(&[0xff, 0xd6, 0x00, page, 0x04]);
    command[5..].copy_from_slice(bytes);
    exchange(card, &command).map(|_| ())
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn exchange(card: &Card, command: &[u8]) -> Result<Vec<u8>, String> {
    let mut buffer = [0u8; 260];
    let response = card
        .transmit(command, &mut buffer)
        .map_err(|error| error.to_string())?;
    if response.len() < 2 || response[response.len() - 2..] != [0x90, 0x00] {
        return Err("reader rejected the NFC tag command".into());
    }
    Ok(response[..response.len() - 2].to_vec())
}

#[cfg(all(test, any(target_os = "linux", target_os = "windows")))]
mod tests {
    use super::*;

    #[test]
    fn type2_tlv_contains_one_padded_ndef_message() {
        assert_eq!(
            type2_tlv(&[0xaa, 0xbb]).unwrap(),
            [0x03, 0x02, 0xaa, 0xbb, 0xfe, 0, 0, 0]
        );
        assert!(type2_tlv(&vec![0; 255]).is_err());
    }

    #[test]
    fn only_empty_type2_memory_is_writable() {
        assert!(is_blank_type2_memory(&[0; 16]));
        assert!(is_blank_type2_memory(&[0x03, 0x00, 0xfe, 0, 0]));
        assert!(!is_blank_type2_memory(&[0x03, 0x03, 0xd1, 0x01]));
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub fn readers() -> Result<Vec<String>, String> {
    Err("NFC writing is available on Windows and Linux".into())
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub fn write_gamepak_card(_reader_name: &str, _id: &str) -> Result<(), String> {
    Err("NFC writing is available on Windows and Linux".into())
}
