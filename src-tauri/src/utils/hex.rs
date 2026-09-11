use anyhow::{Context, Result};

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
    let mut result = Vec::with_capacity(s.len() / 2);
    let mut chars = s.chars();
    while let Some(hi) = chars.next() {
        let lo = chars.next().context("Нечётная длина hex строки")?;
        let byte = u8::from_str_radix(&format!("{}{}", hi, lo), 16)
            .context("Неверный hex символ")?;
        result.push(byte);
    }
    Ok(result)
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
