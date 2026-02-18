import React, { createContext, useContext, useState, useEffect } from 'react';

const LanguageContext = createContext();

const translations = {
  en: {
    // Sidebar
    dashboard: 'Dashboard',
    stores: 'Stores',
    skus_products: 'SKUs / Products',
    orders: 'Orders',
    profitability: 'Profitability',
    purchase_requests: 'Purchase Requests',
    purchases: 'Purchases',
    returns: 'Returns',
    suppliers: 'Suppliers',
    tasks: 'Tasks',
    team: 'Team',
    settings: 'Settings',
    
    // Common buttons
    save: 'Save',
    cancel: 'Cancel',
    edit: 'Edit',
    delete: 'Delete',
    export: 'Export',
    import: 'Import',
    refresh: 'Refresh',
    create_backup: 'Create Backup',
    upload_backup: 'Upload Backup',
    add_store: 'Add Store',
    download: 'Download',
    test_connection: 'Test Connection',
    
    // Settings page
    workspace_settings: 'Workspace Settings',
    currency: 'Currency',
    currency_subtitle: 'Set the default currency for this workspace',
    telegram_integration: 'Telegram Integration',
    telegram_subtitle: 'Configure Telegram bot for daily order notifications',
    bot_token: 'Bot Token',
    chat_id: 'Chat ID',
    currency_example: 'Example',
    telegram_success: 'Telegram test message sent successfully',
    telegram_error: 'Failed to send test message',
    settings_saved: 'Settings saved successfully',
    settings_error: 'Failed to save settings',
    show_token: 'Show Token',
    hide_token: 'Hide Token',
  },
  ar: {
    // Sidebar
    dashboard: 'لوحة التحكم',
    stores: 'المتاجر',
    skus_products: 'المنتجات / الأكواد',
    orders: 'الطلبات',
    profitability: 'الربحية',
    purchase_requests: 'طلبات الشراء',
    purchases: 'المشتريات',
    returns: 'المرتجعات',
    suppliers: 'الموردون',
    tasks: 'المهام',
    team: 'الفريق',
    settings: 'الإعدادات',
    
    // Common buttons
    save: 'حفظ',
    cancel: 'إلغاء',
    edit: 'تعديل',
    delete: 'حذف',
    export: 'تصدير',
    import: 'استيراد',
    refresh: 'تحديث',
    create_backup: 'إنشاء نسخة احتياطية',
    upload_backup: 'رفع نسخة احتياطية',
    add_store: 'إضافة متجر',
    download: 'تحميل',
    test_connection: 'اختبار الاتصال',
    
    // Settings page
    workspace_settings: 'إعدادات الورك سبيس',
    currency: 'العملة',
    currency_subtitle: 'تعيين العملة الافتراضية لهذا الورك سبيس',
    telegram_integration: 'تكامل تيليجرام',
    telegram_subtitle: 'تكوين بوت تيليجرام لإرسال إشعارات الطلبات اليومية',
    bot_token: 'رمز البوت',
    chat_id: 'معرف المحادثة',
    currency_example: 'مثال',
    telegram_success: 'تم إرسال رسالة اختبار تيليجرام بنجاح',
    telegram_error: 'فشل إرسال رسالة الاختبار',
    settings_saved: 'تم حفظ الإعدادات بنجاح',
    settings_error: 'فشل حفظ الإعدادات',
    show_token: 'إظهار الرمز',
    hide_token: 'إخفاء الرمز',
  }
};

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    const saved = localStorage.getItem('ui:lang');
    return saved || 'ar'; // Default to Arabic
  });

  useEffect(() => {
    localStorage.setItem('ui:lang', language);
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  }, [language]);

  const t = (key) => {
    return translations[language]?.[key] || key;
  };

  const toggleLanguage = () => {
    setLanguage(prev => prev === 'en' ? 'ar' : 'en');
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, toggleLanguage, isRTL: language === 'ar' }}>
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