import CryptoJS from 'crypto-js';

// Fallback key for demo purposes if env var is not set
const DEFAULT_KEY = 'bridgesync-local-dev-key-7722';
// Safer access to environment variables to prevent crashes if import.meta.env is undefined
const getEnv = (name: string): string | undefined => {
  try {
    return (import.meta as any).env[name];
  } catch {
    return undefined;
  }
};

const SECRET_KEY = getEnv('VITE_BRIDGE_ENCRYPTION_KEY') || DEFAULT_KEY;

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
