import { useTranslation } from 'react-i18next';

import { FIRMWARE_PRODUCTS } from '@/renderer/lib/flasher/firmwareConfigs';
import type { RNodeModel, RNodeProduct } from '@/renderer/lib/flasher/types';

export interface DeviceSelectorProps {
  selectedProduct: RNodeProduct | null;
  selectedModel: RNodeModel | null;
  disabled?: boolean;
  onProductChange: (product: RNodeProduct | null) => void;
  onModelChange: (model: RNodeModel | null) => void;
}

export function DeviceSelector({
  selectedProduct,
  selectedModel,
  disabled,
  onProductChange,
  onModelChange,
}: DeviceSelectorProps) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-xs text-gray-400">
        {t('flasher.selectProduct')}
        <select
          value={selectedProduct?.id ?? ''}
          disabled={disabled}
          aria-label={t('flasher.selectProduct')}
          onChange={(e) => {
            const id = Number(e.target.value);
            const product = FIRMWARE_PRODUCTS.find((p) => p.id === id) ?? null;
            onProductChange(product);
            onModelChange(null);
          }}
          className="mt-1 block w-full rounded border border-gray-600 bg-slate-900 px-2 py-1.5 text-sm text-gray-200"
        >
          <option value="">{t('flasher.selectProductPlaceholder')}</option>
          {FIRMWARE_PRODUCTS.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-gray-400">
        {t('flasher.selectModel')}
        <select
          value={selectedModel?.id ?? ''}
          disabled={disabled || !selectedProduct}
          aria-label={t('flasher.selectModel')}
          onChange={(e) => {
            const id = Number(e.target.value);
            const model = selectedProduct?.models.find((m) => m.id === id) ?? null;
            onModelChange(model);
          }}
          className="mt-1 block w-full rounded border border-gray-600 bg-slate-900 px-2 py-1.5 text-sm text-gray-200 disabled:opacity-50"
        >
          <option value="">{t('flasher.selectModelPlaceholder')}</option>
          {selectedProduct?.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
