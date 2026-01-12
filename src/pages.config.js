import Dashboard from './pages/Dashboard';
import SKUs from './pages/SKUs';
import Orders from './pages/Orders';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Dashboard": Dashboard,
    "SKUs": SKUs,
    "Orders": Orders,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};