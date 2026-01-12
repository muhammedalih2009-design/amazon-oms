import Dashboard from './pages/Dashboard';
import SKUs from './pages/SKUs';
import Orders from './pages/Orders';
import PurchaseRequests from './pages/PurchaseRequests';
import Purchases from './pages/Purchases';
import Returns from './pages/Returns';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Dashboard": Dashboard,
    "SKUs": SKUs,
    "Orders": Orders,
    "PurchaseRequests": PurchaseRequests,
    "Purchases": Purchases,
    "Returns": Returns,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};