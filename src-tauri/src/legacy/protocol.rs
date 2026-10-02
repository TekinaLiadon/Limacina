use anyhow::{bail, Context, Result};

pub struct HWriter {
    buf: Vec<u8>,
}

impl HWriter {
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    pub fn into_inner(self) -> Vec<u8> {
        self.buf
    }

    pub fn write_u8(&mut self, value: u8) {
        self.buf.push(value);
    }

    pub fn write_bool(&mut self, value: bool) {
        self.buf.push(u8::from(value));
    }

    pub fn write_int(&mut self, value: i32) {
        self.buf.extend_from_slice(&value.to_be_bytes());
    }

    #[cfg(test)]
    pub fn write_long(&mut self, value: i64) {
        self.buf.extend_from_slice(&value.to_be_bytes());
    }

    pub fn write_varint(&mut self, mut value: u32) {
        while value & 0xFFFF_FF80 != 0 {
            self.write_u8((value as u8 & 0x7F) | 0x80);
            value >>= 7;
        }
        self.write_u8(value as u8);
    }

    #[cfg(test)]
    pub fn write_varlong(&mut self, mut value: u64) {
        while value & 0xFFFF_FFFF_FFFF_FF80 != 0 {
            self.write_u8((value as u8 & 0x7F) | 0x80);
            value >>= 7;
        }
        self.write_u8(value as u8);
    }

    pub fn write_fixed(&mut self, bytes: &[u8]) {
        self.buf.extend_from_slice(bytes);
    }

    pub fn write_prefixed(&mut self, bytes: &[u8]) {
        self.write_varint(bytes.len() as u32);
        self.write_fixed(bytes);
    }

    pub fn write_string(&mut self, value: &str) {
        self.write_prefixed(value.as_bytes());
    }
}

impl Default for HWriter {
    fn default() -> Self {
        Self::new()
    }
}

pub struct HReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> HReader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    pub fn remaining(&self) -> usize {
        self.data.len() - self.pos
    }

    fn take(&mut self, len: usize, what: &str) -> Result<&'a [u8]> {
        if self.remaining() < len {
            bail!(
                "Неожиданный конец данных при чтении {what}: нужно {len}, осталось {}",
                self.remaining()
            );
        }
        let slice = &self.data[self.pos..self.pos + len];
        self.pos += len;
        Ok(slice)
    }

    pub fn read_u8(&mut self) -> Result<u8> {
        Ok(self.take(1, "байта")?[0])
    }

    pub fn read_bool(&mut self) -> Result<bool> {
        match self.read_u8()? {
            0 => Ok(false),
            1 => Ok(true),
            other => bail!("Некорректное значение булева значения: {other}"),
        }
    }

    pub fn read_int(&mut self) -> Result<i32> {
        let bytes = self.take(4, "int")?;
        Ok(i32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    #[cfg(test)]
    pub fn read_long(&mut self) -> Result<i64> {
        let bytes = self.take(8, "long")?;
        let mut raw = [0u8; 8];
        raw.copy_from_slice(bytes);
        Ok(i64::from_be_bytes(raw))
    }

    pub fn read_varint(&mut self) -> Result<u32> {
        let mut result: u32 = 0;
        for shift in (0..32).step_by(7) {
            let byte = self.read_u8()?;
            result |= u32::from(byte & 0x7F) << shift;
            if byte & 0x80 == 0 {
                return Ok(result);
            }
        }
        bail!("Varint слишком большой");
    }

    pub fn read_varlong(&mut self) -> Result<u64> {
        let mut result: u64 = 0;
        for shift in (0..64).step_by(7) {
            let byte = self.read_u8()?;
            result |= u64::from(byte & 0x7F) << shift;
            if byte & 0x80 == 0 {
                return Ok(result);
            }
        }
        bail!("VarLong слишком большой");
    }

    pub fn read_fixed(&mut self, len: usize) -> Result<&'a [u8]> {
        self.take(len, "фиксированного блока")
    }

    pub fn read_prefixed(&mut self, max: usize, what: &str) -> Result<&'a [u8]> {
        let len = self.read_varint()? as usize;
        if max != 0 && len > max {
            bail!("Слишком длинный блок {what}: {len} > {max}");
        }
        self.take(len, what)
    }

    pub fn read_string(&mut self, max: usize) -> Result<String> {
        let bytes = self.read_prefixed(max, "строки")?;
        String::from_utf8(bytes.to_vec()).context("Некорректная UTF-8 строка в ответе сервера")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn varint_matches_java_houtput_encoding() {
        let mut w = HWriter::new();
        w.write_varint(0);
        w.write_varint(1);
        w.write_varint(127);
        w.write_varint(128);
        w.write_varint(300);
        w.write_varint(u32::MAX);
        assert_eq!(
            w.into_inner(),
            vec![0x00, 0x01, 0x7F, 0x80, 0x01, 0xAC, 0x02, 0xFF, 0xFF, 0xFF, 0xFF, 0x0F]
        );
    }

    #[test]
    fn varlong_encodes_64_bit_values() {
        let mut w = HWriter::new();
        w.write_varlong(u64::MAX);
        let bytes = w.into_inner();
        assert_eq!(bytes.len(), 10);
        let mut r = HReader::new(&bytes);
        assert_eq!(r.read_varlong().expect("varlong"), u64::MAX);
    }

    #[test]
    fn int_and_long_are_big_endian() {
        let mut w = HWriter::new();
        w.write_int(0x0102_0304);
        w.write_long(0x0102_0304_0506_0708);
        let bytes = w.into_inner();
        assert_eq!(bytes, vec![1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8]);
        let mut r = HReader::new(&bytes);
        assert_eq!(r.read_int().expect("int"), 0x0102_0304);
        assert_eq!(r.read_long().expect("long"), 0x0102_0304_0506_0708);
    }

    #[test]
    fn bool_encodes_single_byte_and_rejects_garbage() {
        let mut w = HWriter::new();
        w.write_bool(true);
        w.write_bool(false);
        let bytes = w.into_inner();
        assert_eq!(bytes, vec![1, 0]);
        let mut ok = HReader::new(&bytes);
        assert!(ok.read_bool().expect("true"));
        assert!(!ok.read_bool().expect("false"));

        let mut bad = HReader::new(&[7]);
        let error = bad
            .read_bool()
            .expect_err("мусор вместо bool должен быть ошибкой");
        assert!(
            error.to_string().contains("Некорректное значение"),
            "{error}"
        );
    }

    #[test]
    fn string_round_trips_utf8_cyrillic() {
        let mut w = HWriter::new();
        w.write_string("Привет мир");
        let bytes = w.into_inner();
        assert_eq!(bytes[0], 19, "varint-длина UTF-8 байтов");
        let mut r = HReader::new(&bytes);
        assert_eq!(r.read_string(255).expect("строка"), "Привет мир");
    }

    #[test]
    fn read_string_enforces_max_length() {
        let mut w = HWriter::new();
        w.write_string("длинная строка");
        let bytes = w.into_inner();
        let mut r = HReader::new(&bytes);
        let error = r
            .read_string(4)
            .expect_err("строка длиннее лимита должна быть ошибкой");
        assert!(
            error.to_string().contains("Слишком длинный блок"),
            "{error}"
        );
    }

    #[test]
    fn truncated_data_reports_eof_error() {
        let mut r = HReader::new(&[0x05, 0x61]);
        let error = r
            .read_string(255)
            .expect_err("обрезанная строка должна вернуть ошибку");
        assert!(
            error.to_string().contains("Неожиданный конец данных"),
            "{error}"
        );
    }

    #[test]
    fn fixed_reads_do_not_use_length_prefix() {
        let mut w = HWriter::new();
        w.write_fixed(&[0xAA, 0xBB]);
        let bytes = w.into_inner();
        assert_eq!(bytes.len(), 2);
        let mut r = HReader::new(&bytes);
        assert_eq!(r.read_fixed(2).expect("фиксированный блок"), &[0xAA, 0xBB]);
        assert_eq!(r.remaining(), 0);
    }
}
