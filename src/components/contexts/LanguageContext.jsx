import React, { createContext, useContext, useState, useEffect } from 'react';
import enTranslations from '@/components/i18n/en.json';
import arTranslations from '@/components/i18n/ar.json';

const translations = {
  en: enTranslations,
  ar: arTranslations
};

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    // Initialize from localStorage before first render to avoid flash
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ui:lang');
      if (saved === 'en' || saved === 'ar') return saved;
    }
    return 'en'; // Default to English
  });

  useEffect(() => {
    // Update HTML lang and dir attributes immediately on mount and change
    document.documentElement.setAttribute('lang', language);
    document.documentElement.setAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
    localStorage.setItem('ui:lang', language);
  }, [language]);

  const setLang = (newLang) => {
    if (newLang === 'en' || newLang === 'ar') {
      setLanguage(newLang);
    }
  };

  const toggleLanguage = () => {
    setLanguage(prev => prev === 'en' ? 'ar' : 'en');
  };

  // Translation function with nested key support (e.g., "common.save")
  const t = (key, params = {}) => {
    const keys = key.split('.');
    let translation = translations[language];
    let fallback = translations['en'];
    
    // Navigate nested keys
    for (const k of keys) {
      translation = translation?.[k];
      fallback = fallback?.[k];
    }
    
    // Use fallback if translation not found
    let result = translation || fallback || key;
    
    // Simple parameter replacement
    if (typeof result === 'string') {
      Object.keys(params).forEach(param => {
        result = result.replace(`{${param}}`, params[param]);
      });
    }
    
    return result;
  };

  const isRTL = language === 'ar';

  return (
    <LanguageContext.Provider value={{ language, lang: language, setLang, setLanguage, toggleLanguage, t, isRTL }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
}