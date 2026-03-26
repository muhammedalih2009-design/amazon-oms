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

    // Helper to fetch and convert image to base64
    const getImageBase64 = async (url) => {
      if (!url) return null;
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < uint8Array.byteLength; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        return 'data:image/jpeg;base64,' + btoa(binary);
      } catch (error) {
        console.error('Failed to fetch image:', url, error);
        return null;
      }
    };

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

    let firstSupplier = true;

    for (const supplierName of supplierNames) {
      const supplierItems = groupedBySupplier[supplierName];
      const supplierTotal = supplierItems.reduce((sum, item) => sum + (item.toBuy * item.unitCost), 0);

      // Page break per supplier (except first)
      if (!firstSupplier) {
        doc.addPage();
      }
      firstSupplier = false;

      let currentY = 15;

      // Supplier header
      doc.setFillColor(79, 70, 229);
      doc.rect(14, currentY, pageWidth - 28, 12, 'F');
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text(supplierName, 16, currentY + 7);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`${supplierItems.length} SKUs | ${supplierItems.reduce((s, i) => s + i.toBuy, 0)} items | $${supplierTotal.toFixed(2)}`, pageWidth - 16, currentY + 7, { align: 'right' });
      doc.setTextColor(0, 0, 0);

      currentY += 15;

      // Fetch images for all items in this supplier
      const imagePromises = supplierItems.map(item => getImageBase64(item.imageUrl));
      const images = await Promise.all(imagePromises);

      // Table with images
      const tableBody = [];
      for (let i = 0; i < supplierItems.length; i++) {
        const item = supplierItems[i];
        tableBody.push([
          '', // Image placeholder
          item.sku || '',
          item.product || '',
          item.toBuy.toString(),
          `$${(item.unitCost || 0).toFixed(2)}`
        ]);
      }

      doc.autoTable({
        startY: currentY,
        head: [['IMAGE', 'SKU', 'PRODUCT', 'TO BUY', 'UNIT COST']],
        body: tableBody,
        theme: 'grid',
        styles: {
          fontSize: 9,
          cellPadding: 3,
          valign: 'middle',
          halign: 'center'
        },
        headStyles: {
          fillColor: [243, 244, 246],
          textColor: [31, 41, 55],
          fontStyle: 'bold',
          halign: 'center'
        },
        columnStyles: {
          0: { cellWidth: 30, halign: 'center' }, // Image column
          1: { cellWidth: 30, halign: 'center' }, // SKU
          2: { cellWidth: 80, halign: 'left' }, // Product
          3: { cellWidth: 20, halign: 'center' }, // To Buy
          4: { cellWidth: 26, halign: 'right' } // Unit Cost
        },
        margin: { left: 14, right: 14 },
        didDrawCell: (data) => {
          // Draw images in the first column
          if (data.column.index === 0 && data.section === 'body') {
            const imageData = images[data.row.index];
            if (imageData) {
              try {
                const cellX = data.cell.x + 2;
                const cellY = data.cell.y + 2;
                const imgWidth = 26;
                const imgHeight = 26;
                doc.addImage(imageData, 'JPEG', cellX, cellY, imgWidth, imgHeight);
              } catch (error) {
                console.error('Failed to add image:', error);
              }
            }
          }
        },
        didDrawPage: (data) => {
          currentY = data.cursor.y;
        }
      });

      // Supplier subtotal
      currentY = doc.lastAutoTable.finalY + 5;
      doc.setFillColor(249, 250, 251);
      doc.rect(14, currentY, pageWidth - 28, 8, 'F');
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(`Subtotal: $${supplierTotal.toFixed(2)}`, pageWidth - 16, currentY + 5, { align: 'right' });
      doc.setFont('helvetica', 'normal');
    }

    // Grand total on last page
    doc.addPage();
    const totalItems = items.reduce((sum, item) => sum + item.toBuy, 0);
    const totalValue = items.reduce((sum, item) => sum + (item.toBuy * item.unitCost), 0);

    doc.setFillColor(238, 242, 255);
    doc.rect(14, 15, pageWidth - 28, 15, 'F');
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`GRAND TOTAL: ${totalItems} items | $${totalValue.toFixed(2)}`, pageWidth - 16, 24, { align: 'right' });

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