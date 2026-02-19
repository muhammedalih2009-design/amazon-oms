/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import AcceptInvite from './pages/AcceptInvite';
import Admin from './pages/Admin';
import BackupData from './pages/BackupData';
import Dashboard from './pages/Dashboard';
import EmergencyRestore from './pages/EmergencyRestore';
import Monitoring from './pages/Monitoring';
import Orders from './pages/Orders';
import OwnerLog from './pages/OwnerLog';
import Profile from './pages/Profile';
import Profitability from './pages/Profitability';
import PurchaseRequests from './pages/PurchaseRequests';
import PurchaseRequestsPrint from './pages/PurchaseRequestsPrint';
import Purchases from './pages/Purchases';
import RateLimitMonitor from './pages/RateLimitMonitor';
import Returns from './pages/Returns';
import SKUs from './pages/SKUs';
import Settings from './pages/Settings';
import Stores from './pages/Stores';
import Suppliers from './pages/Suppliers';
import SuppliersStores from './pages/SuppliersStores';
import Tasks from './pages/Tasks';
import Team from './pages/Team';
import WorkspaceDetails from './pages/WorkspaceDetails';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AcceptInvite": AcceptInvite,
    "Admin": Admin,
    "BackupData": BackupData,
    "Dashboard": Dashboard,
    "EmergencyRestore": EmergencyRestore,
    "Monitoring": Monitoring,
    "Orders": Orders,
    "OwnerLog": OwnerLog,
    "Profile": Profile,
    "Profitability": Profitability,
    "PurchaseRequests": PurchaseRequests,
    "PurchaseRequestsPrint": PurchaseRequestsPrint,
    "Purchases": Purchases,
    "RateLimitMonitor": RateLimitMonitor,
    "Returns": Returns,
    "SKUs": SKUs,
    "Settings": Settings,
    "Stores": Stores,
    "Suppliers": Suppliers,
    "SuppliersStores": SuppliersStores,
    "Tasks": Tasks,
    "Team": Team,
    "WorkspaceDetails": WorkspaceDetails,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};