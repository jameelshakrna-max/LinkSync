import CryptoJS from 'crypto-js';

// Fallback key for demo purposes if env var is not set
const DEFAULT_KEY = 'bridgesync-local-dev-key-7722';
const SECRET_KEY = (import.meta as any).env.VITE_BRIDGE_ENCRYPTION_KEY || DEFAULT_KEY;

/**
 * Encrypts a plain text string using AES.
 */
export const encrypt = (text: string): string => {
  return CryptoJS.AES.encrypt(text, SECRET_KEY).toString();
};

/**
 * Checks if a key name suggests the value is sensitive.
 */
export const isSensitive = (key: string): boolean => {
  const sensitivePatterns = [
    'PASSWORD', 'SECRET', 'TOKEN', 'KEY', 'AUTH', 'PWD', 'PRIVATE'
  ];
  const upperKey = key.toUpperCase();
  return sensitivePatterns.some(pattern => upperKey.includes(pattern));
};
