import { useTranslation } from 'react-i18next';

import { FIRMWARE_PRODUCTS } from '@/renderer/lib/flasher/firmwareConfigs';
import type { RNodeModel, RNodeProduct } from '@/renderer/lib/flasher/types';

import { SELECT_BOX_CLASS } from '../ui/formClasses';

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
      <label className="block text-xs text-zinc-400">
        {t('flasher.selectProduct')}
        <select
          value={selectedProduct?.catalogKey ?? ''}
          disabled={disabled}
          aria-label={t('flasher.selectProduct')}
          onChange={(e) => {
            const catalogKey = e.target.value;
            const product = FIRMWARE_PRODUCTS.find((p) => p.catalogKey === catalogKey) ?? null;
            onProductChange(product);
            onModelChange(null);
          }}
          className={`${SELECT_BOX_CLASS} mt-1 block w-full`}
        >
          <option value="">{t('flasher.selectProductPlaceholder')}</option>
          {FIRMWARE_PRODUCTS.map((product) => (
            <option key={product.catalogKey} value={product.catalogKey}>
              {product.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-zinc-400">
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
          className={`${SELECT_BOX_CLASS} mt-1 block w-full`}
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
