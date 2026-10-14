use anyhow::Result;

use crate::utils::errors::LauncherError;

pub fn to_hex(data: &[u8]) -> String {
    let mut hex = String::with_capacity(data.len() * 2);
    for byte in data {
        use std::fmt::Write as _;
        let _ = write!(hex, "{:02x}", byte);
    }
    hex
}

pub fn digest_hex(digest: impl AsRef<[u8]>) -> String {
    to_hex(digest.as_ref())
}

pub fn from_hex(s: &str) -> Result<Vec<u8>> {
    let bytes = s.as_bytes();
    if !bytes.len().is_multiple_of(2) {
        return Err(
            LauncherError::CredentialsStorage("Нечётная длина hex строки".to_string()).into(),
        );
    }
    let mut result = Vec::with_capacity(bytes.len() / 2);
    for pair in bytes.as_chunks::<2>().0 {
        let hi = hex_digit(pair[0]);
        let lo = hex_digit(pair[1]);
        match (hi, lo) {
            (Some(hi), Some(lo)) => result.push((hi << 4) | lo),
            _ => {
                return Err(LauncherError::CredentialsStorage(format!(
                    "Неверный hex символ в строке: {s}"
                ))
                .into())
            }
        }
    }
    Ok(result)
}

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{from_hex, to_hex};

    #[test]
    fn round_trip() {
        let data = [0u8, 1, 0xab, 0xff];
        let hex = to_hex(&data);
        assert_eq!(hex, "0001abff");
        assert_eq!(from_hex(&hex).expect("hex"), data);
    }

    #[test]
    fn from_hex_rejects_garbage() {
        assert!(from_hex("abc").is_err());
        assert!(from_hex("zz").is_err());
        assert!(from_hex("").unwrap().is_empty());
    }
}
