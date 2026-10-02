use anyhow::{bail, Context, Result};
use rand_core::OsRng;
use rsa::pkcs8::DecodePublicKey;
use rsa::traits::PublicKeyParts;
use rsa::{BigUint, Pkcs1v15Encrypt, RsaPublicKey};
use sha2::{Digest, Sha256};

#[cfg(test)]
use rsa::RsaPrivateKey;

const SHA256_DIGEST_INFO: &[u8] = &[
    0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05,
    0x00, 0x04, 0x20,
];

pub const RSA_KEY_LENGTH: usize = 256;

pub fn parse_public_key(der: &[u8]) -> Result<RsaPublicKey> {
    RsaPublicKey::from_public_key_der(der).context("Не удалось разобрать публичный ключ сервера")
}

pub fn verify_sha256_with_rsa(
    public_key: &RsaPublicKey,
    message: &[u8],
    signature: &[u8],
) -> Result<()> {
    let k = public_key.n().bits().div_ceil(8);
    if signature.len() != k {
        bail!(
            "Длина подписи {} не совпадает с размером ключа {k}",
            signature.len()
        );
    }
    let s = BigUint::from_bytes_be(signature);
    if s >= *public_key.n() {
        bail!("Подпись вне диапазона модуля ключа");
    }
    let em = s.modpow(public_key.e(), public_key.n());
    let mut padded = vec![0u8; k - em.to_bytes_be().len()];
    padded.extend_from_slice(&em.to_bytes_be());

    let hash = Sha256::digest(message);
    let pad_len = k - hash.len() - SHA256_DIGEST_INFO.len() - 3;
    if pad_len < 8 {
        bail!("Слишком маленький отступ подписи: {pad_len}");
    }
    let mut expected = Vec::with_capacity(k);
    expected.push(0x00);
    expected.push(0x01);
    expected.extend(std::iter::repeat_n(0xFF, pad_len));
    expected.push(0x00);
    expected.extend_from_slice(SHA256_DIGEST_INFO);
    expected.extend_from_slice(&hash);

    if padded != expected {
        bail!("Подпись не соответствует данным");
    }
    Ok(())
}

pub fn encrypt_password(public_key: &RsaPublicKey, password: &str) -> Result<Vec<u8>> {
    let max_len = k_bytes(public_key) - 11;
    if password.len() > max_len {
        bail!(
            "Слишком длинный пароль: {} > {max_len} байт",
            password.len()
        );
    }
    public_key
        .encrypt(&mut OsRng, Pkcs1v15Encrypt, password.as_bytes())
        .context("Не удалось зашифровать пароль")
}

fn k_bytes(public_key: &RsaPublicKey) -> usize {
    public_key.n().bits().div_ceil(8)
}

#[cfg(test)]
pub fn generate_test_key(bits: usize) -> Result<RsaPrivateKey> {
    use rsa::RsaPrivateKey;

    let mut rng = OsRng;
    RsaPrivateKey::new(&mut rng, bits).context("Не удалось сгенерировать тестовый ключ")
}

#[cfg(test)]
pub fn sign_sha256_with_rsa_raw(private_key: &RsaPrivateKey, message: &[u8]) -> Result<Vec<u8>> {
    use rsa::traits::PrivateKeyParts;
    let hash = Sha256::digest(message);
    let k = private_key.n().bits().div_ceil(8);
    let pad_len = k - hash.len() - SHA256_DIGEST_INFO.len() - 3;
    if pad_len < 8 {
        bail!("Слишком маленький отступ подписи: {pad_len}");
    }
    let mut em = Vec::with_capacity(k);
    em.push(0x00);
    em.push(0x01);
    em.extend(std::iter::repeat_n(0xFF, pad_len));
    em.push(0x00);
    em.extend_from_slice(SHA256_DIGEST_INFO);
    em.extend_from_slice(&hash);

    let m = BigUint::from_bytes_be(&em);
    let d = private_key.d();
    let n = private_key.n();
    if m >= *n {
        bail!("Сообщение подписи больше модуля ключа");
    }
    let s = m.modpow(d, n);
    let mut sig = vec![0u8; k - s.to_bytes_be().len()];
    sig.extend_from_slice(&s.to_bytes_be());
    Ok(sig)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_DER: &[u8] = &[
        0x30, 0x82, 0x01, 0x22, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01,
        0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x01, 0x0f, 0x00, 0x30, 0x82, 0x01, 0x0a, 0x02, 0x82,
        0x01, 0x01, 0x00, 0x83, 0xfa, 0xd8, 0x97, 0xd8, 0x2c, 0x26, 0x7b, 0x3a, 0xa4, 0xa4, 0x88,
        0xcd, 0x4b, 0x9f, 0x92, 0xe9, 0x87, 0x30, 0x30, 0x12, 0x30, 0xd4, 0x86, 0xea, 0xde, 0xb9,
        0xaa, 0xb0, 0x5d, 0xd0, 0x47, 0xc7, 0x4c, 0xe6, 0xc8, 0x40, 0x63, 0x03, 0x8e, 0x2e, 0xc5,
        0x80, 0x3a, 0xcc, 0x39, 0xe9, 0x50, 0x7d, 0x7e, 0xc4, 0xbc, 0xb5, 0x91, 0xdc, 0x6b, 0x1e,
        0x0a, 0x78, 0x30, 0x22, 0x39, 0x25, 0xfb, 0x66, 0x06, 0x84, 0x65, 0x22, 0x2b, 0xad, 0xd9,
        0xe3, 0xfe, 0xa2, 0x9e, 0x05, 0x61, 0xea, 0xd9, 0xcd, 0xb4, 0xae, 0x6e, 0x20, 0x15, 0x49,
        0xac, 0x5d, 0xc0, 0xe7, 0xbe, 0x3e, 0x43, 0x5a, 0x33, 0xf7, 0xcf, 0xb2, 0xf6, 0xa1, 0x36,
        0x8a, 0xdb, 0x81, 0xd2, 0xa1, 0xbc, 0xe1, 0xf0, 0x8c, 0xf2, 0x1d, 0x0d, 0x8e, 0x9a, 0xe8,
        0x89, 0x5f, 0x02, 0x9b, 0xba, 0xd1, 0xdc, 0xb3, 0x66, 0x9d, 0x8c, 0x00, 0x85, 0xba, 0x9b,
        0xdc, 0x56, 0x50, 0x21, 0xed, 0x9f, 0x84, 0xa0, 0x58, 0x9f, 0xff, 0x29, 0xb2, 0x69, 0x05,
        0x76, 0xd0, 0x79, 0x75, 0xda, 0x2e, 0xcb, 0xf3, 0xfc, 0xbb, 0x28, 0x25, 0x55, 0x99, 0x95,
        0x69, 0xab, 0x3b, 0xbb, 0x55, 0xf8, 0x6b, 0x20, 0x63, 0xb6, 0x93, 0xaf, 0x04, 0xc0, 0xc9,
        0xf3, 0x30, 0x6c, 0x96, 0xbf, 0x86, 0xeb, 0x88, 0xa1, 0xa2, 0x8a, 0x5e, 0xf9, 0x09, 0xb6,
        0x75, 0x1f, 0x38, 0xea, 0x1d, 0x18, 0x85, 0x86, 0x62, 0xa6, 0xac, 0xee, 0xd1, 0x95, 0x73,
        0xc0, 0xa6, 0xe3, 0x2f, 0x9b, 0x49, 0x05, 0xf1, 0x26, 0x96, 0xf0, 0x79, 0xf0, 0xd1, 0x57,
        0xfa, 0x31, 0x54, 0xa8, 0x3d, 0xfe, 0x18, 0xd8, 0x77, 0x96, 0xef, 0x76, 0x51, 0x66, 0x40,
        0x1f, 0x3f, 0xe1, 0xc5, 0x1c, 0xce, 0x67, 0x3d, 0x0f, 0xaa, 0x58, 0x3b, 0xb3, 0x8e, 0x6d,
        0x83, 0x9e, 0xd2, 0x1b, 0x02, 0x03, 0x01, 0x00, 0x01,
    ];

    #[test]
    fn parses_real_launcher_public_key() {
        let key = parse_public_key(TEST_DER).expect("ключ сервера должен разбираться");
        assert_eq!(key.n().bits(), 2048);
        assert_eq!(k_bytes(&key), RSA_KEY_LENGTH);
    }

    #[test]
    fn rejects_garbage_der() {
        assert!(parse_public_key(&[0x30, 0x00]).is_err());
    }

    #[test]
    fn round_trip_sign_and_verify_with_synthetic_key() {
        let key = generate_test_key(2048).expect("генерация ключа");
        let public_key = RsaPublicKey::from(&key);
        let message = b"legacy profile payload";

        let signature = sign_sha256_with_rsa_raw(&key, message).expect("подпись");
        assert_eq!(signature.len(), RSA_KEY_LENGTH);
        verify_sha256_with_rsa(&public_key, message, &signature).expect("валидная подпись");
    }

    #[test]
    fn verify_fails_on_modified_message() {
        let key = generate_test_key(2048).expect("генерация ключа");
        let public_key = RsaPublicKey::from(&key);
        let signature = sign_sha256_with_rsa_raw(&key, b"first").expect("подпись");

        let error = verify_sha256_with_rsa(&public_key, b"second", &signature)
            .expect_err("подпись другого сообщения должна отвергаться");
        assert!(error.to_string().contains("не соответствует"), "{error}");
    }

    #[test]
    fn verify_fails_on_wrong_key() {
        let signer = generate_test_key(2048).expect("генерация ключа подписи");
        let other = generate_test_key(2048).expect("генерация постороннего ключа");
        let message = b"payload";
        let signature = sign_sha256_with_rsa_raw(&signer, message).expect("подпись");

        assert!(verify_sha256_with_rsa(&RsaPublicKey::from(&other), message, &signature).is_err());
    }

    #[test]
    fn verify_rejects_wrong_signature_length() {
        let key = parse_public_key(TEST_DER).expect("ключ");
        let error = verify_sha256_with_rsa(&key, b"x", &[0u8; 128])
            .expect_err("короткая подпись должна отвергаться");
        assert!(error.to_string().contains("Длина подписи"), "{error}");
    }

    #[test]
    fn encrypt_password_produces_key_sized_block() {
        let key = parse_public_key(TEST_DER).expect("ключ сервера");
        let encrypted = encrypt_password(&key, "пароль123").expect("шифрование пароля");
        assert_eq!(encrypted.len(), RSA_KEY_LENGTH);
        assert_ne!(encrypted, "пароль123".as_bytes().to_vec());
    }

    #[test]
    fn encrypt_password_rejects_oversized_input() {
        let key = parse_public_key(TEST_DER).expect("ключ сервера");
        let long = "п".repeat(300);
        let error = encrypt_password(&key, &long).expect_err("пароль больше блока должен пасть");
        assert!(
            error.to_string().contains("Слишком длинный пароль"),
            "{error}"
        );
    }
}
