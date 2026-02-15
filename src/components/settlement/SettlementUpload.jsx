import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/components/hooks/useTenant';
import SettlementUploadChunked from './SettlementUploadChunked';

export default function SettlementUpload({ onSuccess }) {
  return <SettlementUploadChunked onSuccess={onSuccess} />;