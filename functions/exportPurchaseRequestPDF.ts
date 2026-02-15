import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jsPDF } from 'npm:jspdf@2.5.2';
import 'npm:jspdf-autotable@3.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { items, fileName } = body;

    if (!items || !Array.isArray(items)) {
      return Response.json({ error: 'Invalid items data' }, { status: 400 });
    }

    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;

    // Header
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Purchase Requests', 14, 15);
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 21);

    // Group by supplier
    const groupedBySupplier = items.reduce((acc, item) => {
      const supplier = item.supplier || 'Unassigned';
      if (!acc[supplier]) acc[supplier] = [];
      acc[supplier].push(item);
      return acc;
    }, {});

    const supplierNames = Object.keys(groupedBySupplier).sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b, 'en', { sensitivity: 'base' });
    });

    let currentY = 28;

    for (const supplierName of supplierNames) {
      const supplierItems = groupedBySupplier[supplierName];
      const supplierTotal = supplierItems.reduce((sum, item) => sum + (item.toBuy * item.unitCost), 0);

      // Check if we need a new page for supplier header
      if (currentY > pageHeight - 60) {
        doc.addPage();
        currentY = 15;
      }

      // Supplier header
      doc.setFillColor(243, 244, 246);
      doc.rect(14, currentY, pageWidth - 28, 10, 'F');
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(supplierName, 16, currentY + 6);
      doc.setFont('helvetica', 'normal');
      doc.text(`${supplierItems.length} SKUs | ${supplierItems.reduce((s, i) => s + i.toBuy, 0)} items | $${supplierTotal.toFixed(2)}`, pageWidth - 16, currentY + 6, { align: 'right' });

      currentY += 12;

      // Table for this supplier
      const tableData = supplierItems.map(item => [
        item.sku || '',
        item.product || '',
        item.toBuy.toString(),
        `$${(item.unitCost || 0).toFixed(2)}`
      ]);

      doc.autoTable({
        startY: currentY,
        head: [['SKU', 'Product', 'To Buy', 'Unit Cost']],
        body: tableData,
        theme: 'grid',
        styles: {
          fontSize: 8,
          cellPadding: 2,
        },
        headStyles: {
          fillColor: [229, 231, 235],
          textColor: [51, 65, 85],
          fontStyle: 'bold',
          halign: 'left'
        },
        columnStyles: {
          0: { cellWidth: 25 },
          1: { cellWidth: 90 },
          2: { cellWidth: 20, halign: 'center' },
          3: { cellWidth: 25, halign: 'right' }
        },
        margin: { left: 14, right: 14 },
        didDrawPage: (data) => {
          currentY = data.cursor.y;
        }
      });

      currentY = doc.lastAutoTable.finalY + 8;
    }

    // Grand total
    const totalItems = items.reduce((sum, item) => sum + item.toBuy, 0);
    const totalValue = items.reduce((sum, item) => sum + (item.toBuy * item.unitCost), 0);

    if (currentY > pageHeight - 20) {
      doc.addPage();
      currentY = 15;
    }

    doc.setFillColor(249, 250, 251);
    doc.rect(14, currentY, pageWidth - 28, 12, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`GRAND TOTAL: ${totalItems} items | $${totalValue.toFixed(2)}`, pageWidth - 16, currentY + 7, { align: 'right' });

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName || 'purchase_requests.pdf'}"`
      }
    });
  } catch (error) {
    console.error('PDF export error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});