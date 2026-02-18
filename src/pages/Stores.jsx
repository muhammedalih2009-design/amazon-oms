import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';

// Redirect old /stores route to SuppliersStores page with stores section open
export default function Stores() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate(createPageUrl('SuppliersStores') + '?open=stores', { replace: true });
  }, [navigate]);

  return null;
}