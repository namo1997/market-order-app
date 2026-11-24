import apiClient from './client';

// "บรรจุแพ็คละ" ต่อสินค้า (เช่น ไก่ย่าง 5 ตัว/ถุง)
export const productPackSizesAPI = {
  list: async () => (await apiClient.get('/production/pack-sizes')).data,
  save: async (productId, packSize, packUnitLabel) => (
    await apiClient.put(`/production/pack-sizes/${productId}`, { pack_size: packSize, pack_unit_label: packUnitLabel })
  ).data
};
