/**
 * NomaanOS Nexus AI - Multilingual Support Service (Day 15)
 *
 * Provides language detection, multilingual configuration hooks, and localized prompt formatting.
 * Supports configurable multilingual model policies (e.g. standard local vs multilingual).
 */

import { config } from '../config/env.js';

export interface LanguageInfo {
  code: string;
  name: string;
  direction: 'ltr' | 'rtl';
  isSupported: boolean;
}

export const SUPPORTED_LANGUAGES: Record<string, LanguageInfo> = {
  en: { code: 'en', name: 'English', direction: 'ltr', isSupported: true },
  es: { code: 'es', name: 'Spanish (Español)', direction: 'ltr', isSupported: true },
  fr: { code: 'fr', name: 'French (Français)', direction: 'ltr', isSupported: true },
  de: { code: 'de', name: 'German (Deutsch)', direction: 'ltr', isSupported: true },
  ja: { code: 'ja', name: 'Japanese (日本語)', direction: 'ltr', isSupported: true },
  zh: { code: 'zh', name: 'Chinese (中文)', direction: 'ltr', isSupported: true },
  pt: { code: 'pt', name: 'Portuguese (Português)', direction: 'ltr', isSupported: true },
  ar: { code: 'ar', name: 'Arabic (العربية)', direction: 'rtl', isSupported: true },
};

/**
 * Basic heuristic language detection for common European and CJK characters.
 */
export function detectLanguage(text: string): string {
  if (!text) return config.multilingual.defaultLanguage;

  // Japanese Hiragana / Katakana
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'ja';
  // Chinese Hanzi (without Japanese kana)
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
  // Arabic script
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';

  const lower = text.toLowerCase();
  // Spanish keywords
  if (/\b(hola|por favor|cuál|qué|cómo|seguridad|política)\b/.test(lower)) return 'es';
  // French keywords
  if (/\b(bonjour|merci|sécurité|politique|comment)\b/.test(lower)) return 'fr';
  // German keywords
  if (/\b(hallo|bitte|sicherheit|richtlinie|warum)\b/.test(lower)) return 'de';

  return 'en';
}

/**
 * Checks whether a language code is currently supported by the platform configuration.
 */
export function isLanguageSupported(langCode: string): boolean {
  const norm = langCode.trim().toLowerCase();
  return config.multilingual.supportedLanguages.includes(norm);
}

/**
 * Generates multilingual system prompt instructions ensuring the model responds in the target language.
 */
export function getMultilingualPromptInstruction(targetLanguage: string): string {
  const lang = SUPPORTED_LANGUAGES[targetLanguage.toLowerCase()] || SUPPORTED_LANGUAGES.en;
  if (lang.code === 'en') return '';

  return [
    '',
    `=== MULTILINGUAL RESPONSE INSTRUCTION ===`,
    `The user has requested responses in ${lang.name} [${lang.code}].`,
    `You must formulate your grounded response entirely in ${lang.name}, while preserving accurate technical terms, error codes, and source citations [1], [2].`,
  ].join('\n');
}

/**
 * Localized template responses for common offline acknowledgments.
 */
export const LOCALIZED_RESPONSES: Record<string, { insufficientEvidence: string; greeting: string }> = {
  en: {
    insufficientEvidence: 'Insufficient Evidence: The available documentation does not contain sufficient verified records to answer your inquiry.',
    greeting: 'Hello! I am ready to assist you across the NomaanOS platform.',
  },
  es: {
    insufficientEvidence: 'Evidencia Insuficiente: La documentación disponible no contiene registros verificados suficientes para responder a su consulta.',
    greeting: '¡Hola! Estoy listo para asistirlo en la plataforma NomaanOS.',
  },
  fr: {
    insufficientEvidence: 'Preuves Insuffisantes: La documentation disponible ne contient pas suffisamment d’enregistrements vérifiés pour répondre à votre demande.',
    greeting: 'Bonjour ! Je suis prêt à vous assister sur la plateforme NomaanOS.',
  },
  de: {
    insufficientEvidence: 'Unzureichende Beweise: Die verfügbare Dokumentation enthält nicht genügend verifizierte Datensätze, um Ihre Anfrage zu beantworten.',
    greeting: 'Hallo! Ich bin bereit, Sie auf der NomaanOS-Plattform zu unterstützen.',
  },
};

