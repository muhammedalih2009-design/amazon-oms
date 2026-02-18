import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/components/utils/apiClient';

export function usePaginatedQuery(entityName, filters = {}, sort = null, pageSize = 50) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async (pageNum = 1, append = false) => {
    if (loading) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const result = await apiClient.list(
        entityName,
        filters,
        sort,
        pageSize,
        { useCache: true, cacheTTL: 45000 }
      );
      
      if (append) {
        setData(prev => [...prev, ...result]);
      } else {
        setData(result);
      }
      
      setHasMore(result.length === pageSize);
      setPage(pageNum);
    } catch (err) {
      setError(err.message || 'Failed to load data');
      console.error(`[usePaginatedQuery] Error loading ${entityName}:`, err);
    } finally {
      setLoading(false);
    }
  }, [entityName, JSON.stringify(filters), sort, pageSize]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchData(page + 1, true);
    }
  }, [page, loading, hasMore, fetchData]);

  const refresh = useCallback(() => {
    apiClient.clearEntityCache(entityName);
    fetchData(1, false);
  }, [entityName, fetchData]);

  useEffect(() => {
    fetchData(1, false);
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    hasMore,
    loadMore,
    refresh,
    page
  };
}