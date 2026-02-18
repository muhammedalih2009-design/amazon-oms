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
    
    // Admin navigation
    platform_admin: 'Platform Admin',
    emergency_restore: 'Emergency Restore',
    rate_limit_monitor: 'Rate Limit Monitor',
    system_monitoring: 'System Monitoring',
    admin_tools: 'Admin Tools',
    
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
    search: 'Search',
    export_csv: 'Export CSV',
    upload: 'Upload',
    status: 'Status',
    active: 'Active',
    paused: 'Paused',
    resume: 'Resume',
    force_stop: 'Force Stop',
    actions: 'Actions',
    view: 'View',
    filter: 'Filter',
    apply: 'Apply',
    reset: 'Reset',
    confirm: 'Confirm',
    close: 'Close',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    
    // Auth
    sign_out: 'Sign Out',
    
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
    
    // Admin navigation
    platform_admin: 'إدارة المنصة',
    emergency_restore: 'استعادة طارئة',
    rate_limit_monitor: 'مراقبة حدود الطلبات',
    system_monitoring: 'مراقبة النظام',
    admin_tools: 'أدوات الإدارة',
    
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
    search: 'بحث',
    export_csv: 'تصدير CSV',
    upload: 'رفع',
    status: 'الحالة',
    active: 'نشط',
    paused: 'متوقف',
    resume: 'استئناف',
    force_stop: 'إيقاف قسري',
    actions: 'الإجراءات',
    view: 'عرض',
    filter: 'تصفية',
    apply: 'تطبيق',
    reset: 'إعادة تعيين',
    confirm: 'تأكيد',
    close: 'إغلاق',
    loading: 'جاري التحميل...',
    error: 'خطأ',
    success: 'نجح',
    
    // Auth
    sign_out: 'تسجيل الخروج',
    
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

  const t = (key) => {
    return translations[language]?.[key] || key;
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