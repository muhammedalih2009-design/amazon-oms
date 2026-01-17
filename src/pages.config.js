import Admin from './pages/Admin';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import Profile from './pages/Profile';
import PurchaseRequests from './pages/PurchaseRequests';
import Purchases from './pages/Purchases';
import Returns from './pages/Returns';
import SKUs from './pages/SKUs';
import Settlement from './pages/Settlement';
import Suppliers from './pages/Suppliers';
import Team from './pages/Team';
import Tasks from './pages/Tasks';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Admin": Admin,
    "Dashboard": Dashboard,
    "Orders": Orders,
    "Profile": Profile,
    "PurchaseRequests": PurchaseRequests,
    "Purchases": Purchases,
    "Returns": Returns,
    "SKUs": SKUs,
    "Settlement": Settlement,
    "Suppliers": Suppliers,
    "Team": Team,
    "Tasks": Tasks,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};