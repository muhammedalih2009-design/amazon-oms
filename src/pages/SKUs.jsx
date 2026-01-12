import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import { format } from 'date-fns';
import { Package, Plus, Search, Edit, Trash2, Upload as UploadIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import DataTable from '@/components/shared/DataTable';
import CSVUploader from '@/components/shared/CSVUploader';
import BatchHistory from '@/components/shared/BatchHistory';
import PaywallBanner from '@/components/ui/PaywallBanner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function SKUs() {
  const { tenantId, subscription, isActive } = useTenant();
  const [skus, setSkus] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingSku, setEditingSku] = useState(null);
  const [formData, setFormData] = useState({
    sku_code: '',
    product_name: '',
    cost_price: '',
    supplier_id: '',
    image_url: ''
  });
  const [processing, setProcessing] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId]);

  const loadData = async () => {
    setLoading(true);
    const [skusData, suppliersData, batchesData] = await Promise.all([
      base44.entities.SKU.filter({ tenant_id: tenantId }),
      base44.entities.Supplier.filter({ tenant_id: tenantId }),
      base44.entities.ImportBatch.filter({ tenant_id: tenantId, batch_type: 'skus' })
    ]);
    setSkus(skusData);
    setSuppliers(suppliersData);
    setBatches(batchesData.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
    setLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const data = {
      ...formData,
      tenant_id: tenantId,
      cost_price: parseFloat(formData.cost_price) || 0
    };

    if (editingSku) {
      await base44.entities.SKU.update(editingSku.id, data);
    } else {
      await base44.entities.SKU.create(data);
    }
    
    setShowForm(false);
    setEditingSku(null);
    setFormData({ sku_code: '', product_name: '', cost_price: '', supplier_id: '', image_url: '' });
    loadData();
  };

  const handleEdit = (sku) => {
    setEditingSku(sku);
    setFormData({
      sku_code: sku.sku_code,
      product_name: sku.product_name,
      cost_price: sku.cost_price?.toString() || '',
      supplier_id: sku.supplier_id || '',
      image_url: sku.image_url || ''
    });
    setShowForm(true);
  };

  const handleDelete = async (sku) => {
    if (confirm('Are you sure you want to delete this SKU?')) {
      await base44.entities.SKU.delete(sku.id);
      loadData();
    }
  };

  const handleCSVUpload = async (file) => {
    setProcessing(true);
    
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    
    const result = await base44.integrations.Core.ExtractDataFromUploadedFile({
      file_url,
      json_schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sku_code: { type: 'string' },
            product_name: { type: 'string' },
            cost_price: { type: 'number' },
            supplier: { type: 'string' },
            image_url: { type: 'string' }
          }
        }
      }
    });

    const batch = await base44.entities.ImportBatch.create({
      tenant_id: tenantId,
      batch_type: 'skus',
      batch_name: `SKUs Import - ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
      filename: file.name,
      status: 'processing',
      total_rows: 0
    });

    const rows = result.output || [];
    let successCount = 0;
    let failedCount = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      
      if (!row.sku_code || !row.product_name) {
        failedCount++;
        errors.push({
          row_number: i + 1,
          raw_row_json: JSON.stringify(row),
          error_reason: 'Missing required fields: sku_code or product_name'
        });
        continue;
      }

      const existing = skus.find(s => s.sku_code === row.sku_code);
      if (existing) {
        failedCount++;
        errors.push({
          row_number: i + 1,
          raw_row_json: JSON.stringify(row),
          error_reason: `Duplicate SKU code: ${row.sku_code}`
        });
        continue;
      }

      let supplierId = null;
      if (row.supplier) {
        const supplier = suppliers.find(s => 
          s.supplier_name.toLowerCase() === row.supplier.toLowerCase()
        );
        supplierId = supplier?.id;
      }

      await base44.entities.SKU.create({
        tenant_id: tenantId,
        sku_code: row.sku_code,
        product_name: row.product_name,
        cost_price: parseFloat(row.cost_price) || 0,
        supplier_id: supplierId,
        image_url: row.image_url || '',
        import_batch_id: batch.id
      });
      successCount++;
    }

    // Save errors
    for (const error of errors) {
      await base44.entities.ImportError.create({
        tenant_id: tenantId,
        batch_id: batch.id,
        ...error
      });
    }

    const status = failedCount === 0 ? 'success' : 
                   successCount === 0 ? 'failed' : 'partial';

    await base44.entities.ImportBatch.update(batch.id, {
      status,
      total_rows: rows.length,
      success_rows: successCount,
      failed_rows: failedCount
    });

    setUploadResult({
      status,
      total_rows: rows.length,
      success_rows: successCount,
      failed_rows: failedCount
    });

    setProcessing(false);
    loadData();
  };

  const filteredSkus = skus.filter(sku =>
    sku.sku_code?.toLowerCase().includes(search.toLowerCase()) ||
    sku.product_name?.toLowerCase().includes(search.toLowerCase())
  );

  const columns = [
    { 
      key: 'sku_code', 
      header: 'SKU Code', 
      sortable: true,
      render: (val) => <span className="font-medium text-slate-900">{val}</span>
    },
    { 
      key: 'product_name', 
      header: 'Product Name', 
      sortable: true 
    },
    { 
      key: 'cost_price', 
      header: 'Cost Price', 
      align: 'right',
      sortable: true,
      render: (val) => `$${(val || 0).toFixed(2)}`
    },
    { 
      key: 'supplier_id', 
      header: 'Supplier',
      render: (val) => {
        const supplier = suppliers.find(s => s.id === val);
        return supplier?.supplier_name || '-';
      }
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (_, row) => (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="icon" onClick={() => handleEdit(row)}>
            <Edit className="w-4 h-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => handleDelete(row)}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      )
    }
  ];

  const csvTemplate = 'data:text/csv;charset=utf-8,sku_code,product_name,cost_price,supplier,image_url\nSKU001,Product Name,19.99,Supplier Name,https://example.com/image.jpg';

  return (
    <div className="space-y-6">
      <PaywallBanner subscription={subscription} onUpgrade={() => {}} />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">SKUs / Products</h1>
          <p className="text-slate-500">Manage your product catalog</p>
        </div>
        <Button 
          onClick={() => setShowForm(true)}
          className="bg-indigo-600 hover:bg-indigo-700"
          disabled={!isActive}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add SKU
        </Button>
      </div>

      <Tabs defaultValue="list" className="space-y-6">
        <TabsList>
          <TabsTrigger value="list">Products List</TabsTrigger>
          <TabsTrigger value="import">Import CSV</TabsTrigger>
          <TabsTrigger value="history">Import History</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search SKUs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          <DataTable
            columns={columns}
            data={filteredSkus}
            loading={loading}
            emptyIcon={Package}
            emptyTitle="No products yet"
            emptyDescription="Add your first product to get started"
            emptyAction="Add SKU"
            onEmptyAction={() => setShowForm(true)}
          />
        </TabsContent>

        <TabsContent value="import">
          <CSVUploader
            title="Import SKUs"
            description="Upload a CSV file to bulk import products"
            templateUrl={csvTemplate}
            templateName="skus_template.csv"
            onUpload={handleCSVUpload}
            processing={processing}
            result={uploadResult}
            onReset={() => setUploadResult(null)}
          />
        </TabsContent>

        <TabsContent value="history">
          <BatchHistory
            batches={batches}
            loading={loading}
            showDelete={false}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingSku ? 'Edit SKU' : 'Add New SKU'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sku_code">SKU Code *</Label>
              <Input
                id="sku_code"
                value={formData.sku_code}
                onChange={(e) => setFormData({...formData, sku_code: e.target.value})}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product_name">Product Name *</Label>
              <Input
                id="product_name"
                value={formData.product_name}
                onChange={(e) => setFormData({...formData, product_name: e.target.value})}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost_price">Cost Price *</Label>
              <Input
                id="cost_price"
                type="number"
                step="0.01"
                value={formData.cost_price}
                onChange={(e) => setFormData({...formData, cost_price: e.target.value})}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier">Supplier</Label>
              <Select
                value={formData.supplier_id}
                onValueChange={(val) => setFormData({...formData, supplier_id: val})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.supplier_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="image_url">Image URL</Label>
              <Input
                id="image_url"
                value={formData.image_url}
                onChange={(e) => setFormData({...formData, image_url: e.target.value})}
              />
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700">
                {editingSku ? 'Update' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}