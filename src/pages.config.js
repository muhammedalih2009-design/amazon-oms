import Dashboard from './pages/Dashboard';
import SKUs from './pages/SKUs';
import Orders from './pages/Orders';
import PurchaseRequests from './pages/PurchaseRequests';
import Purchases from './pages/Purchases';
import Returns from './pages/Returns';
import Settlement from './pages/Settlement';
import Suppliers from './pages/Suppliers';
import Admin from './pages/Admin';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Dashboard": Dashboard,
    "SKUs": SKUs,
    "Orders": Orders,
    "PurchaseRequests": PurchaseRequests,
    "Purchases": Purchases,
    "Returns": Returns,
    "Settlement": Settlement,
    "Suppliers": Suppliers,
    "Admin": Admin,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};