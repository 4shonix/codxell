/**
 * End-to-End Encryption Utilities
 * Uses Web Crypto API for secure message encryption
 */

export interface KeyPair {
    publicKey: CryptoKey;
    privateKey: CryptoKey;
}

export interface EncryptedMessage {
    encryptedData: string;
    encryptedKey: string;
    iv: string;
}

/**
 * Generate RSA key pair for encryption
 */
export async function generateKeyPair(): Promise<KeyPair> {
    const keyPair = await window.crypto.subtle.generateKey(
        {
            name: 'RSA-OAEP',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
        },
        true,
        ['encrypt', 'decrypt']
    );

    return {
        publicKey: keyPair.publicKey,
        privateKey: keyPair.privateKey,
    };
}

/**
 * Export public key to base64 string for transmission
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
    const exported = await window.crypto.subtle.exportKey('spki', publicKey);
    return arrayBufferToBase64(exported);
}

/**
 * Import public key from base64 string
 */
export async function importPublicKey(base64Key: string): Promise<CryptoKey> {
    const keyData = base64ToArrayBuffer(base64Key);
    return await window.crypto.subtle.importKey(
        'spki',
        keyData,
        {
            name: 'RSA-OAEP',
            hash: 'SHA-256',
        },
        true,
        ['encrypt']
    );
}

/**
 * Encrypt a message using hybrid encryption (AES + RSA)
 */
export async function encryptMessage(
    message: string,
    recipientPublicKey: CryptoKey
): Promise<EncryptedMessage> {
    // Generate random AES key
    const aesKey = await window.crypto.subtle.generateKey(
        {
            name: 'AES-GCM',
            length: 256,
        },
        true,
        ['encrypt', 'decrypt']
    );

    // Generate random IV
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    // Encrypt message with AES
    const encodedMessage = new TextEncoder().encode(message);
    const encryptedData = await window.crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv,
        },
        aesKey,
        encodedMessage
    );

    // Export AES key
    const exportedAesKey = await window.crypto.subtle.exportKey('raw', aesKey);

    // Encrypt AES key with RSA public key
    const encryptedKey = await window.crypto.subtle.encrypt(
        {
            name: 'RSA-OAEP',
        },
        recipientPublicKey,
        exportedAesKey
    );

    return {
        encryptedData: arrayBufferToBase64(encryptedData),
        encryptedKey: arrayBufferToBase64(encryptedKey),
        iv: arrayBufferToBase64(iv),
    };
}

/**
 * Decrypt a message using hybrid decryption
 */
export async function decryptMessage(
    encrypted: EncryptedMessage,
    privateKey: CryptoKey
): Promise<string> {
    try {
        // Decrypt AES key with RSA private key
        const encryptedKeyBuffer = base64ToArrayBuffer(encrypted.encryptedKey);
        const aesKeyBuffer = await window.crypto.subtle.decrypt(
            {
                name: 'RSA-OAEP',
            },
            privateKey,
            encryptedKeyBuffer
        );

        // Import AES key
        const aesKey = await window.crypto.subtle.importKey(
            'raw',
            aesKeyBuffer,
            {
                name: 'AES-GCM',
                length: 256,
            },
            false,
            ['decrypt']
        );

        // Decrypt message with AES
        const encryptedDataBuffer = base64ToArrayBuffer(encrypted.encryptedData);
        const ivBuffer = base64ToArrayBuffer(encrypted.iv);

        const decryptedData = await window.crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: ivBuffer,
            },
            aesKey,
            encryptedDataBuffer
        );

        return new TextDecoder().decode(decryptedData);
    } catch (error) {
        console.error('Decryption failed:', error);
        throw new Error('Failed to decrypt message');
    }
}

/**
 * Encrypt file content
 */
export async function encryptFile(
    fileContent: string,
    recipientPublicKey: CryptoKey
): Promise<EncryptedMessage> {
    // Files are base64 encoded, so we encrypt them the same way as messages
    return encryptMessage(fileContent, recipientPublicKey);
}

/**
 * Decrypt file content
 */
export async function decryptFile(
    encrypted: EncryptedMessage,
    privateKey: CryptoKey
): Promise<string> {
    return decryptMessage(encrypted, privateKey);
}

/**
 * Utility: Convert ArrayBuffer to base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Utility: Convert base64 to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Sanitize text input to prevent XSS
 */
export function sanitizeInput(input: string): string {
    const div = document.createElement('div');
    div.textContent = input;
    return div.innerHTML;
}
