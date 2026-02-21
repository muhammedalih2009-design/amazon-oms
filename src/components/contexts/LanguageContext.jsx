import React, { createContext, useContext, useState, useEffect } from 'react';

const translations = {
  en: {
    common: { refresh: "Refresh", save: "Save", cancel: "Cancel", delete: "Delete", edit: "Edit", add: "Add", search: "Search", filter: "Filter", export: "Export", import: "Import", upload: "Upload", download: "Download", close: "Close", confirm: "Confirm", back: "Back", next: "Next", done: "Done", loading: "Loading...", noData: "No data available", error: "Error", success: "Success", warning: "Warning", info: "Info", actions: "Actions", view: "View", copyLink: "Copy Link", exportCsv: "Export CSV", bulkUpload: "Bulk Upload", bulkUpdate: "Bulk Update", selectAll: "Select All", deselectAll: "Deselect All", selected: "Selected", items: "items", yes: "Yes", no: "No" },
    sidebar: { dashboard: "Dashboard", skus_products: "SKUs / Products", orders: "Orders", profitability: "Profitability", purchase_requests: "Purchase Requests", purchases: "Purchases", returns: "Returns", suppliers: "Suppliers", tasks: "Tasks", team: "Team", settings: "Settings", backup_data: "Backup & Data", admin_tools: "Admin Tools", platform_admin: "Platform Admin", emergency_restore: "Emergency Restore", rate_limit_monitor: "Rate Limit Monitor", system_monitoring: "System Monitoring", sign_out: "Sign Out" },
    dashboard: { title: "Dashboard", subtitle: "Overview of your business metrics", stockValue: "Stock Value", purchasedCostSuppliers: "Purchased Stock Cost (Suppliers)", purchasedCostWarehouse: "Purchased Stock Cost (Warehouse)", monthlyRevenue: "Monthly Revenue", monthlyProfit: "Monthly Profit", revenueVsCostProfit: "Revenue vs Cost vs Profit", topSKUs: "Top 10 SKUs by Quantity", recentOrders: "Recent Orders", viewAll: "View All", orderId: "Order ID", date: "Date", status: "Status", revenue: "Revenue", profit: "Profit", pendingTasks: "Pending Tasks" },
    skus: { title: "SKUs / Products", subtitle: "Manage your product inventory", addSku: "Add SKU", bulkUpload: "Bulk Upload", bulkUpdate: "Bulk Update", exportCsv: "Export CSV", template: "Download Template", checkIntegrity: "Check Integrity", resetAllStockToZero: "Reset All Stock to Zero", clearStock: "Clear Stock", deleteSelected: "Delete Selected", searchPlaceholder: "Search by SKU code or title...", filters: { all: "All Products", lowStock: "Low Stock", outOfStock: "Out of Stock", newestFirst: "Newest First", oldestFirst: "Oldest First", rowsPerPage: "Rows per page" }, empty: { title: "No products yet", subtitle: "Add your first product to get started" }, table: { skuCode: "SKU Code", title: "Title", currentStock: "Current Stock", costPrice: "Cost Price", sellingPrice: "Selling Price", supplier: "Supplier", createdDate: "Created Date" }, integrity: { title: "Stock Integrity Check", checking: "Checking stock integrity...", noIssues: "No issues found", issuesFound: "Issues found", fix: "Fix Issues" } },
    orders: { title: "Orders", subtitle: "Manage customer orders", bulkUpload: "Bulk Upload", exportCsv: "Export CSV", searchPlaceholder: "Search by Order ID...", filters: { all: "All Orders", pending: "Pending", fulfilled: "Fulfilled", returned: "Returned" }, table: { orderId: "Order ID", store: "Store", date: "Date", status: "Status", revenue: "Revenue", cost: "Cost", profit: "Profit", margin: "Margin" }, empty: { title: "No orders yet", subtitle: "Upload your first order to get started" } },
    profitability: { title: "Profitability", subtitle: "Line-level profit analysis for fulfilled orders", uploadRevenue: "Upload Revenue", uploading: "Uploading...", totalRevenue: "Total Revenue", totalCost: "Total Cost", netProfit: "Net Profit", avgMargin: "Avg Margin", lastImport: "Last Import", matched: "Matched", unmatched: "Unmatched", filters: { allStores: "All Stores", matchedOnly: "Matched Only", unmatchedOnly: "Unmatched Only" }, table: { orderId: "Order ID", store: "Store", date: "Date", lines: "Lines", cost: "Cost", revenue: "Revenue", profit: "Profit", margin: "Margin", matchStatus: "Match Status" } },
    purchases: { title: "Purchases", subtitle: "Track inventory purchases", addPurchase: "Add Purchase", bulkUpload: "Bulk Upload", exportCsv: "Export CSV", searchPlaceholder: "Search...", table: { purchaseId: "Purchase ID", supplier: "Supplier", sku: "SKU", quantity: "Quantity", unitCost: "Unit Cost", totalCost: "Total Cost", date: "Date", location: "Location" }, empty: { title: "No purchases yet", subtitle: "Add your first purchase to get started" } },
    returns: { title: "Returns", subtitle: "Manage product returns", addReturn: "Add Return", exportCsv: "Export CSV", searchPlaceholder: "Search...", table: { returnId: "Return ID", orderId: "Order ID", sku: "SKU", quantity: "Quantity", reason: "Reason", date: "Date", status: "Status" }, empty: { title: "No returns yet", subtitle: "Returns will appear here" } },
    suppliers: { title: "Suppliers & Stores", subtitle: "Manage your suppliers and stores", addSupplier: "Add Supplier", addStore: "Add Store", exportCsv: "Export CSV", suppliers: "Suppliers", stores: "Stores", searchPlaceholder: "Search...", empty: { suppliers: { title: "No suppliers yet", subtitle: "Add your first supplier to get started" }, stores: { title: "No stores yet", subtitle: "Add your first store to get started" } } },
    tasks: { title: "Tasks", subtitle: "Manage your team tasks", addTask: "Add Task", filters: { all: "All Tasks", pending: "Pending", inProgress: "In Progress", completed: "Completed" }, empty: { title: "No tasks yet", subtitle: "Create your first task to get started" } },
    team: { title: "Team", subtitle: "Manage workspace members", inviteMember: "Invite Member", table: { name: "Name", email: "Email", role: "Role", permissions: "Permissions", joinedDate: "Joined Date", actions: "Actions" }, roles: { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" }, empty: { title: "No team members yet", subtitle: "Invite your first team member" } },
    settings: { title: "Settings", subtitle: "Workspace settings and preferences", workspace_settings: "Workspace Settings", currency: "Currency", currency_subtitle: "Choose your default currency", currency_example: "Currency example", save: "Save", telegram_integration: "Telegram Integration", telegram_subtitle: "Configure Telegram notifications", bot_token: "Bot Token", chat_id: "Chat ID", test_connection: "Test connection", settings_saved: "Settings saved", settings_error: "Error", currencySettings: { title: "Currency Settings", subtitle: "Set your preferred currency for the workspace", label: "Currency", save: "Save Currency" }, telegram: { title: "Telegram Integration", subtitle: "Connect Telegram for notifications", botToken: "Bot Token", chatId: "Chat ID", save: "Save Settings", test: "Test Connection", instructions: "Get your bot token from @BotFather and chat ID from @userinfobot" } },
    backup: { title: "Backup & Data", subtitle: "Manage workspace data and backups", dataPackage: { title: "Workspace Data Package", subtitle: "Export or import complete workspace data", download: "Download" }, backupRestore: { title: "Backup & Restore", subtitle: "Create snapshots and restore workspace data", createBackup: "Create Backup" } },
    auth: { login: "Login", logout: "Logout", signIn: "Sign In", signOut: "Sign Out", email: "Email", password: "Password", forgotPassword: "Forgot Password?", createAccount: "Create Account", alreadyHaveAccount: "Already have an account?", dontHaveAccount: "Don't have an account?" },
    errors: { generic: "Something went wrong", notFound: "Not found", unauthorized: "Unauthorized", forbidden: "Forbidden", serverError: "Server error", networkError: "Network error", tryAgain: "Try again" },
    messages: { saveSuccess: "Saved successfully", deleteSuccess: "Deleted successfully", updateSuccess: "Updated successfully", uploadSuccess: "Uploaded successfully", copiedToClipboard: "Copied to clipboard", confirmDelete: "Are you sure you want to delete this item?", confirmAction: "Are you sure you want to proceed?", noChanges: "No changes made" }
  },
  ar: {
    common: { refresh: "تحديث", save: "حفظ", cancel: "إلغاء", delete: "حذف", edit: "تعديل", add: "إضافة", search: "بحث", filter: "تصفية", export: "تصدير", import: "استيراد", upload: "رفع", download: "تنزيل", close: "إغلاق", confirm: "تأكيد", back: "رجوع", next: "التالي", done: "تم", loading: "جاري التحميل...", noData: "لا توجد بيانات", error: "خطأ", success: "نجح", warning: "تحذير", info: "معلومات", actions: "إجراءات", view: "عرض", copyLink: "نسخ الرابط", exportCsv: "تصدير CSV", bulkUpload: "رفع جماعي", bulkUpdate: "تحديث جماعي", selectAll: "تحديد الكل", deselectAll: "إلغاء التحديد", selected: "محدد", items: "عناصر", yes: "نعم", no: "لا" },
    sidebar: { dashboard: "لوحة التحكم", skus_products: "المنتجات", orders: "الطلبات", profitability: "الربحية", purchase_requests: "طلبات الشراء", purchases: "المشتريات", returns: "المرتجعات", suppliers: "الموردين", tasks: "المهام", team: "الفريق", settings: "الإعدادات", backup_data: "النسخ الاحتياطي", admin_tools: "أدوات الإدارة", platform_admin: "إدارة النظام", emergency_restore: "استعادة طارئة", rate_limit_monitor: "مراقبة المعدل", system_monitoring: "مراقبة النظام", sign_out: "تسجيل الخروج" },
    dashboard: { title: "لوحة التحكم", subtitle: "نظرة عامة على مقاييس عملك", stockValue: "قيمة المخزون", purchasedCostSuppliers: "تكلفة المخزون المشترى (الموردين)", purchasedCostWarehouse: "تكلفة المخزون المشترى (المستودع)", monthlyRevenue: "الإيرادات الشهرية", monthlyProfit: "الربح الشهري", revenueVsCostProfit: "الإيرادات مقابل التكلفة مقابل الربح", topSKUs: "أفضل 10 منتجات بالكمية", recentOrders: "الطلبات الأخيرة", viewAll: "عرض الكل", orderId: "رقم الطلب", date: "التاريخ", status: "الحالة", revenue: "الإيرادات", profit: "الربح", pendingTasks: "المهام المعلقة" },
    skus: { title: "المنتجات", subtitle: "إدارة مخزون المنتجات", addSku: "إضافة منتج", bulkUpload: "رفع جماعي", bulkUpdate: "تحديث جماعي", exportCsv: "تصدير CSV", template: "تنزيل النموذج", checkIntegrity: "فحص السلامة", resetAllStockToZero: "إعادة تعيين المخزون إلى صفر", clearStock: "مسح المخزون", deleteSelected: "حذف المحدد", searchPlaceholder: "البحث برمز SKU أو العنوان...", filters: { all: "كل المنتجات", lowStock: "مخزون منخفض", outOfStock: "نفد المخزون", newestFirst: "الأحدث أولاً", oldestFirst: "الأقدم أولاً", rowsPerPage: "صفوف في الصفحة" }, empty: { title: "لا توجد منتجات بعد", subtitle: "أضف أول منتج للبدء" }, table: { skuCode: "رمز SKU", title: "العنوان", currentStock: "المخزون الحالي", costPrice: "سعر التكلفة", sellingPrice: "سعر البيع", supplier: "المورد", createdDate: "تاريخ الإنشاء" }, integrity: { title: "فحص سلامة المخزون", checking: "جاري فحص سلامة المخزون...", noIssues: "لم يتم العثور على مشاكل", issuesFound: "تم العثور على مشاكل", fix: "إصلاح المشاكل" } },
    orders: { title: "الطلبات", subtitle: "إدارة طلبات العملاء", bulkUpload: "رفع جماعي", exportCsv: "تصدير CSV", searchPlaceholder: "البحث برقم الطلب...", filters: { all: "كل الطلبات", pending: "معلق", fulfilled: "مكتمل", returned: "مرتجع" }, table: { orderId: "رقم الطلب", store: "المتجر", date: "التاريخ", status: "الحالة", revenue: "الإيرادات", cost: "التكلفة", profit: "الربح", margin: "الهامش" }, empty: { title: "لا توجد طلبات بعد", subtitle: "ارفع أول طلب للبدء" } },
    profitability: { title: "الربحية", subtitle: "تحليل الربح على مستوى الصنف للطلبات المكتملة", uploadRevenue: "رفع الإيرادات", uploading: "جاري الرفع...", totalRevenue: "إجمالي الإيرادات", totalCost: "إجمالي التكلفة", netProfit: "صافي الربح", avgMargin: "متوسط الهامش", lastImport: "آخر استيراد", matched: "مطابق", unmatched: "غير مطابق", filters: { allStores: "كل المتاجر", matchedOnly: "المطابق فقط", unmatchedOnly: "غير المطابق فقط" }, table: { orderId: "رقم الطلب", store: "المتجر", date: "التاريخ", lines: "الأصناف", cost: "التكلفة", revenue: "الإيرادات", profit: "الربح", margin: "الهامش", matchStatus: "حالة المطابقة" } },
    purchases: { title: "المشتريات", subtitle: "تتبع مشتريات المخزون", addPurchase: "إضافة مشترى", bulkUpload: "رفع جماعي", exportCsv: "تصدير CSV", searchPlaceholder: "بحث...", table: { purchaseId: "رقم المشترى", supplier: "المورد", sku: "المنتج", quantity: "الكمية", unitCost: "تكلفة الوحدة", totalCost: "التكلفة الإجمالية", date: "التاريخ", location: "الموقع" }, empty: { title: "لا توجد مشتريات بعد", subtitle: "أضف أول مشترى للبدء" } },
    returns: { title: "المرتجعات", subtitle: "إدارة مرتجعات المنتجات", addReturn: "إضافة مرتجع", exportCsv: "تصدير CSV", searchPlaceholder: "بحث...", table: { returnId: "رقم المرتجع", orderId: "رقم الطلب", sku: "المنتج", quantity: "الكمية", reason: "السبب", date: "التاريخ", status: "الحالة" }, empty: { title: "لا توجد مرتجعات بعد", subtitle: "ستظهر المرتجعات هنا" } },
    suppliers: { title: "الموردين والمتاجر", subtitle: "إدارة الموردين والمتاجر", addSupplier: "إضافة مورد", addStore: "إضافة متجر", exportCsv: "تصدير CSV", suppliers: "الموردين", stores: "المتاجر", searchPlaceholder: "بحث...", empty: { suppliers: { title: "لا يوجد موردين بعد", subtitle: "أضف أول مورد للبدء" }, stores: { title: "لا توجد متاجر بعد", subtitle: "أضف أول متجر للبدء" } } },
    tasks: { title: "المهام", subtitle: "إدارة مهام الفريق", addTask: "إضافة مهمة", filters: { all: "كل المهام", pending: "معلق", inProgress: "قيد التنفيذ", completed: "مكتمل" }, empty: { title: "لا توجد مهام بعد", subtitle: "أنشئ أول مهمة للبدء" } },
    team: { title: "الفريق", subtitle: "إدارة أعضاء مساحة العمل", inviteMember: "دعوة عضو", table: { name: "الاسم", email: "البريد الإلكتروني", role: "الدور", permissions: "الصلاحيات", joinedDate: "تاريخ الانضمام", actions: "الإجراءات" }, roles: { owner: "مالك", admin: "مدير", member: "عضو", viewer: "مشاهد" }, empty: { title: "لا يوجد أعضاء بعد", subtitle: "ادع أول عضو للفريق" } },
    settings: { title: "الإعدادات", subtitle: "إعدادات وتفضيلات مساحة العمل", workspace_settings: "إعدادات مساحة العمل", currency: "العملة", currency_subtitle: "اختر العملة الافتراضية", currency_example: "مثال عرض العملة", save: "حفظ", telegram_integration: "تكامل تيليجرام", telegram_subtitle: "إعداد إشعارات تيليجرام", bot_token: "رمز البوت", chat_id: "معرف المحادثة", test_connection: "اختبار الاتصال", settings_saved: "تم حفظ الإعدادات", settings_error: "خطأ", currencySettings: { title: "إعدادات العملة", subtitle: "حدد العملة المفضلة لمساحة العمل", label: "العملة", save: "حفظ العملة" }, telegram: { title: "تكامل تليجرام", subtitle: "ربط تليجرام للإشعارات", botToken: "رمز البوت", chatId: "معرف المحادثة", save: "حفظ الإعدادات", test: "اختبار الاتصال", instructions: "احصل على رمز البوت من @BotFather ومعرف المحادثة من @userinfobot" } },
    backup: { title: "النسخ الاحتياطي والبيانات", subtitle: "إدارة بيانات ونسخ مساحة العمل الاحتياطية", dataPackage: { title: "حزمة بيانات مساحة العمل", subtitle: "تصدير أو استيراد بيانات مساحة العمل الكاملة", download: "تنزيل" }, backupRestore: { title: "النسخ الاحتياطي والاستعادة", subtitle: "إنشاء لقطات واستعادة بيانات مساحة العمل", createBackup: "إنشاء نسخة احتياطية" } },
    auth: { login: "تسجيل الدخول", logout: "تسجيل الخروج", signIn: "تسجيل الدخول", signOut: "تسجيل الخروج", email: "البريد الإلكتروني", password: "كلمة المرور", forgotPassword: "نسيت كلمة المرور؟", createAccount: "إنشاء حساب", alreadyHaveAccount: "هل لديك حساب بالفعل؟", dontHaveAccount: "ليس لديك حساب؟" },
    errors: { generic: "حدث خطأ ما", notFound: "غير موجود", unauthorized: "غير مصرح", forbidden: "محظور", serverError: "خطأ في الخادم", networkError: "خطأ في الشبكة", tryAgain: "حاول مرة أخرى" },
    messages: { saveSuccess: "تم الحفظ بنجاح", deleteSuccess: "تم الحذف بنجاح", updateSuccess: "تم التحديث بنجاح", uploadSuccess: "تم الرفع بنجاح", copiedToClipboard: "تم النسخ إلى الحافظة", confirmDelete: "هل أنت متأكد من حذف هذا العنصر؟", confirmAction: "هل أنت متأكد من المتابعة؟", noChanges: "لم يتم إجراء أي تغييرات" }
  }
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
    
    // Use fallback if translation not found or is an object
    let result = (typeof translation === 'string' ? translation : null) 
                 || (typeof fallback === 'string' ? fallback : null) 
                 || key;
    
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