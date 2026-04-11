import { useEffect, useState } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { Card } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { adminAPI } from '../../../api/admin';

export const LineNotificationSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState('line');
  const [enabled, setEnabled] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [hasAccessToken, setHasAccessToken] = useState(false);
  const [hasGroupId, setHasGroupId] = useState(false);
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [discordReceivingWebhookUrl, setDiscordReceivingWebhookUrl] = useState('');
  const [fields, setFields] = useState(['date', 'branch', 'department', 'count', 'items']);
  const [groups, setGroups] = useState([]);
  const [editingGroups, setEditingGroups] = useState({});
  const [isDirty, setIsDirty] = useState(false);
  const defaultFields = ['date', 'branch', 'department', 'count', 'items'];
  const localTokenCount = groups.reduce(
    (sum, group) =>
      sum +
      (Array.isArray(group.accessTokens)
        ? group.accessTokens.filter((entry) => entry?.token).length
        : 0),
    0
  );
  const localGroupCount =
    provider === 'discord'
      ? groups.filter((group) => group?.enabled !== false).length
      : groups.filter((group) => Boolean(group.id)).length;
  const providerLabel = provider === 'discord' ? 'Discord' : 'LINE';
  const tokenPlaceholder = provider === 'discord' ? 'https://discord.com/api/webhooks/...' : 'Token #';

  const normalizeAccessTokens = (tokens = []) =>
    tokens
      .map((entry) => {
        if (typeof entry === 'string') {
          return { name: '', token: entry };
        }
        if (entry && typeof entry === 'object') {
          return { name: entry.name || '', token: entry.token || '' };
        }
        return null;
      })
      .filter(Boolean);

  const normalizeGroup = (group = {}) => ({
    id: group?.id || '',
    name: group?.name || '',
    enabled: group?.enabled !== false,
    accessTokens: Array.isArray(group?.accessTokens)
      ? normalizeAccessTokens(group.accessTokens)
      : group?.accessToken
        ? normalizeAccessTokens([group.accessToken])
        : [],
    quotaMode: group?.quotaMode === 'auto' ? 'auto' : 'manual',
    fields:
      Array.isArray(group?.fields) && group.fields.length > 0
        ? group.fields
        : defaultFields
  });

  const createDefaultGroup = (nextProvider = provider) =>
    normalizeGroup({
      id: '',
      name: nextProvider === 'discord' ? 'กลุ่ม Discord' : 'กลุ่ม LINE',
      enabled: true,
      fields: defaultFields
    });

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getLineNotificationSettings();
      const data = response?.data ?? response;
      const nextProvider = data?.provider === 'discord' ? 'discord' : 'line';
      setProvider(nextProvider);
      setEnabled(Boolean(data?.enabled));
      setConfigured(Boolean(data?.configured));
      setHasAccessToken(Boolean(data?.hasAccessToken));
      setHasGroupId(Boolean(data?.hasGroupId));
      setDiscordWebhookUrl(String(data?.discordWebhookUrl || ''));
      setDiscordReceivingWebhookUrl(String(data?.discordReceivingWebhookUrl || ''));
      if (Array.isArray(data?.fields) && data.fields.length > 0) {
        setFields(data.fields);
      } else {
        setFields(defaultFields);
      }
      if (Array.isArray(data?.groups)) {
        setGroups(
          data.groups.length > 0
            ? data.groups.map(normalizeGroup)
            : [
                createDefaultGroup(nextProvider)
              ]
        );
      } else {
        setGroups([createDefaultGroup(nextProvider)]);
      }
      setIsDirty(false);
    } catch (error) {
      console.error('Error fetching notification settings:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleToggle = async () => {
    const nextState = !enabled;
    const label = nextState ? 'เปิด' : 'ปิด';
    if (!confirm(`ต้องการ${label}การแจ้งเตือน ${providerLabel} ใช่หรือไม่?`)) {
      return;
    }

    try {
      setSaving(true);
      await adminAPI.updateLineNotificationSettings({
        enabled: nextState,
        provider,
        accessToken: '',
        groupId: '',
        discordWebhookUrl,
        discordReceivingWebhookUrl,
        fields,
        groups
      });
      setEnabled(nextState);
      setIsDirty(false);
    } catch (error) {
      console.error('Error updating notification settings:', error);
      const message = error.response?.data?.message || 'เกิดข้อผิดพลาดในการอัปเดตสถานะ';
      alert(message);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await adminAPI.updateLineNotificationSettings({
        enabled,
        provider,
        accessToken: '',
        groupId: '',
        discordWebhookUrl,
        discordReceivingWebhookUrl,
        fields,
        groups
      });
      await fetchSettings();
      setIsDirty(false);
    } catch (error) {
      console.error('Error updating notification settings:', error);
      const message = error.response?.data?.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล';
      alert(message);
    } finally {
      setSaving(false);
    }
  };

  const handleGroupChange = (index, field, value) => {
    setIsDirty(true);
    setGroups((prev) =>
      prev.map((group, idx) =>
        idx === index ? { ...group, [field]: value } : group
      )
    );
  };

  const handleGroupTokenChange = (groupIndex, tokenIndex, value) => {
    setIsDirty(true);
    setGroups((prev) =>
      prev.map((group, idx) => {
        if (idx !== groupIndex) return group;
        const tokens = Array.isArray(group.accessTokens)
          ? group.accessTokens.map((entry) => ({ ...entry }))
          : [];
        const current = tokens[tokenIndex] || { name: '', token: '' };
        tokens[tokenIndex] = { ...current, token: value };
        return { ...group, accessTokens: tokens };
      })
    );
  };

  const handleGroupTokenNameChange = (groupIndex, tokenIndex, value) => {
    setIsDirty(true);
    setGroups((prev) =>
      prev.map((group, idx) => {
        if (idx !== groupIndex) return group;
        const tokens = Array.isArray(group.accessTokens)
          ? group.accessTokens.map((entry) => ({ ...entry }))
          : [];
        const current = tokens[tokenIndex] || { name: '', token: '' };
        tokens[tokenIndex] = { ...current, name: value };
        return { ...group, accessTokens: tokens };
      })
    );
  };

  const handleAddGroupToken = (groupIndex) => {
    setIsDirty(true);
    setGroups((prev) =>
      prev.map((group, idx) => {
        if (idx !== groupIndex) return group;
        const tokens = Array.isArray(group.accessTokens) ? [...group.accessTokens] : [];
        tokens.push({ name: '', token: '' });
        return { ...group, accessTokens: tokens };
      })
    );
  };

  const handleRemoveGroupToken = (groupIndex, tokenIndex) => {
    setIsDirty(true);
    setGroups((prev) =>
      prev.map((group, idx) => {
        if (idx !== groupIndex) return group;
        const tokens = Array.isArray(group.accessTokens) ? [...group.accessTokens] : [];
        tokens.splice(tokenIndex, 1);
        return { ...group, accessTokens: tokens };
      })
    );
  };

  const handleGroupFieldToggle = (index, key) => {
    setIsDirty(true);
    setGroups((prev) =>
      prev.map((group, idx) => {
        if (idx !== index) return group;
        const currentFields = Array.isArray(group.fields) ? group.fields : [];
        const nextFields = currentFields.includes(key)
          ? currentFields.filter((item) => item !== key)
          : [...currentFields, key];
        return { ...group, fields: nextFields };
      })
    );
  };

  const handleAddGroup = () => {
    setIsDirty(true);
    setGroups((prev) => {
      const next = [
        ...prev,
        createDefaultGroup(provider)
      ];
      const newIndex = next.length - 1;
      setEditingGroups((current) => ({ ...current, [newIndex]: true }));
      return next;
    });
  };

  const handleRemoveGroup = (index) => {
    setIsDirty(true);
    setGroups((prev) => prev.filter((_, idx) => idx !== index));
    setEditingGroups((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const toggleGroupEdit = (index) => {
    setEditingGroups((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const handleProviderChange = (nextProvider) => {
    setProvider(nextProvider);
    setIsDirty(true);
    setGroups((prev) => {
      if (Array.isArray(prev) && prev.length > 0) {
        return prev.map((group) => ({
          ...group,
          id: nextProvider === 'discord' ? '' : group.id
        }));
      }
      return [createDefaultGroup(nextProvider)];
    });
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          ตั้งค่าการแจ้งเตือน
        </h1>

        <Card>
          {loading ? (
            <p className="text-gray-500">กำลังโหลดข้อมูล...</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-sm text-gray-500">สถานะการแจ้งเตือน</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {enabled ? `เปิดใช้งาน ${providerLabel}` : 'ปิดใช้งานอยู่'}
                  </p>
                </div>
                <Button onClick={handleToggle} disabled={saving}>
                  {saving ? 'กำลังบันทึก...' : enabled ? 'ปิดการแจ้งเตือน' : 'เปิดการแจ้งเตือน'}
                </Button>
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-sm font-medium text-gray-700 mb-2">ช่องทางการแจ้งเตือน</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 rounded border border-gray-200 bg-white px-3 py-2 text-sm">
                    <input
                      type="radio"
                      name="provider"
                      checked={provider === 'line'}
                      onChange={() => handleProviderChange('line')}
                      className="h-4 w-4 text-blue-600"
                    />
                    LINE
                  </label>
                  <label className="flex items-center gap-2 rounded border border-gray-200 bg-white px-3 py-2 text-sm">
                    <input
                      type="radio"
                      name="provider"
                      checked={provider === 'discord'}
                      onChange={() => handleProviderChange('discord')}
                      className="h-4 w-4 text-blue-600"
                    />
                    Discord
                  </label>
                </div>
              </div>

              {provider === 'discord' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">
                      Discord Webhook หลัก (แจ้งสั่งซื้อ/แก้ไข/ยกเลิก)
                    </label>
                    <input
                      type="text"
                      value={discordWebhookUrl}
                      onChange={(e) => {
                        setDiscordWebhookUrl(e.target.value);
                        setIsDirty(true);
                      }}
                      placeholder="https://discord.com/api/webhooks/..."
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">
                      Discord Webhook รับสินค้า (รับเข้า/รับอัตโนมัติ)
                    </label>
                    <input
                      type="text"
                      value={discordReceivingWebhookUrl}
                      onChange={(e) => {
                        setDiscordReceivingWebhookUrl(e.target.value);
                        setIsDirty(true);
                      }}
                      placeholder="https://discord.com/api/webhooks/..."
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-gray-700">
                    กลุ่มที่ต้องการแจ้งเตือน
                  </p>
                  <Button variant="secondary" size="sm" onClick={handleAddGroup}>
                    เพิ่มกลุ่ม
                  </Button>
                </div>
                <div className="space-y-4">
                  {groups.map((group, index) => {
                    const isEditing =
                      editingGroups[index] ??
                      (!group.id && !group.name && (group.accessTokens?.length || 0) === 0);
                    const fieldOptions = [
                      { key: 'date', label: 'วันที่สั่ง' },
                      { key: 'branch', label: 'สาขา' },
                      { key: 'department', label: 'แผนก' },
                      { key: 'count', label: 'จำนวนรายการ' },
                      { key: 'items', label: 'รายละเอียดจำนวนรายการที่สั่งซื้อ' }
                    ];
                    const selectedFields = fieldOptions
                      .filter((option) =>
                        Array.isArray(group.fields) && group.fields.includes(option.key)
                      )
                      .map((option) => option.label);

                    return (
                      <div key={`${group.id}-${index}`} className="border rounded-lg p-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={Boolean(group.enabled)}
                              onChange={(e) => handleGroupChange(index, 'enabled', e.target.checked)}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm font-medium text-gray-700">
                              เปิดแจ้งเตือนกลุ่มนี้
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleRemoveGroup(index)}
                            >
                              ลบกลุ่ม
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => toggleGroupEdit(index)}
                            >
                              {isEditing ? 'ซ่อนรายละเอียด' : 'แก้ไข'}
                            </Button>
                          </div>
                        </div>

                        <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold">
                              {group.name || `${providerLabel} กลุ่ม (ยังไม่ตั้งชื่อ)`}
                            </span>
                            <span className="text-xs text-gray-500">
                              {group.accessTokens?.length || 0} {provider === 'discord' ? 'webhook' : 'token'}
                            </span>
                          </div>
                          {provider === 'line' ? (
                            <p className="mt-1 text-xs text-gray-500">Group ID: {group.id || '-'}</p>
                          ) : null}
                          {(group.accessTokens || []).length === 0 ? (
                            <p className="mt-2 text-xs text-gray-500">
                              {provider === 'discord' ? 'ยังไม่มี webhook' : 'ยังไม่มี token'}
                            </p>
                          ) : (
                            <div className="mt-2 space-y-1 text-xs">
                              {(group.accessTokens || []).map((token, tokenIndex) => (
                                <div key={`${index}-summary-${tokenIndex}`}>
                                  <span className="font-semibold text-gray-600">
                                    {token?.name || `โปรไฟล์ #${tokenIndex + 1}`}:
                                  </span>{' '}
                                  <span className="font-mono break-all text-gray-700">
                                    {token?.token || '-'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {isEditing ? (
                          <>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div>
                                <label className="block text-sm text-gray-600 mb-1">ชื่อกลุ่ม</label>
                                <input
                                  type="text"
                                  value={group.name || ''}
                                  onChange={(e) => handleGroupChange(index, 'name', e.target.value)}
                                  placeholder="ใส่ชื่อกลุ่ม"
                                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              {provider === 'line' ? (
                                <div>
                                  <label className="block text-sm text-gray-600 mb-1">Group ID</label>
                                  <input
                                    type="text"
                                    value={group.id || ''}
                                    onChange={(e) => handleGroupChange(index, 'id', e.target.value)}
                                    placeholder="ใส่ Group ID"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                </div>
                              ) : null}
                              <div className="sm:col-span-2">
                                <label className="block text-sm text-gray-600 mb-1">
                                  {provider === 'discord'
                                    ? 'Webhook URLs (หลายตัวต่อ 1 กลุ่ม)'
                                    : 'Channel access tokens (หลายตัวต่อ 1 กลุ่ม)'}
                                </label>
                                <p className="text-xs text-gray-500 mb-2">
                                  มี {group.accessTokens?.length || 0} {provider === 'discord' ? 'webhook' : 'token'}
                                </p>
                                <div className="space-y-2">
                                  {(group.accessTokens || []).map((token, tokenIndex) => (
                                    <div
                                      key={`${index}-token-${tokenIndex}`}
                                      className="flex flex-col gap-2 sm:flex-row sm:items-center"
                                    >
                                      <input
                                        type="text"
                                        value={token?.name || ''}
                                        onChange={(e) =>
                                          handleGroupTokenNameChange(index, tokenIndex, e.target.value)
                                        }
                                        placeholder={`ชื่อโปรไฟล์ #${tokenIndex + 1}`}
                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                      <input
                                        type="text"
                                        value={token?.token || ''}
                                        onChange={(e) =>
                                          handleGroupTokenChange(index, tokenIndex, e.target.value)
                                        }
                                        placeholder={`${tokenPlaceholder}${provider === 'discord' ? '' : tokenIndex + 1}`}
                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                      <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => handleRemoveGroupToken(index, tokenIndex)}
                                      >
                                        ลบ token
                                      </Button>
                                    </div>
                                  ))}
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => handleAddGroupToken(index)}
                                  >
                                    {provider === 'discord' ? 'เพิ่ม webhook' : 'เพิ่ม token'}
                                  </Button>
                                </div>
                              </div>
                              {provider === 'line' ? (
                                <div className="sm:col-span-2">
                                  <label className="block text-sm text-gray-600 mb-1">
                                    โหมดการส่ง (Auto จะหยุดส่งเมื่อโควตาเต็ม)
                                  </label>
                                  <select
                                    value={group.quotaMode || 'manual'}
                                    onChange={(e) =>
                                      handleGroupChange(index, 'quotaMode', e.target.value)
                                    }
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  >
                                    <option value="manual">Manual (ไม่เช็คโควตา)</option>
                                    <option value="auto">Auto (หยุดส่งเมื่อโควตาเต็ม)</option>
                                  </select>
                                </div>
                              ) : null}
                            </div>
                            <div className="mt-3">
                              <p className="text-sm font-medium text-gray-700 mb-2">
                                เลือกรายการที่ต้องการแจ้งเตือน
                              </p>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {fieldOptions.map((option) => (
                                  <label
                                    key={`${option.key}-${index}`}
                                    className="flex items-center gap-2 text-sm text-gray-600"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={
                                        Array.isArray(group.fields) &&
                                        group.fields.includes(option.key)
                                      }
                                      onChange={() => handleGroupFieldToggle(index, option.key)}
                                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    {option.label}
                                  </label>
                                ))}
                              </div>
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-gray-500">
                            รายการที่แจ้งเตือน:{' '}
                            {selectedFields.length > 0 ? selectedFields.join(', ') : 'ยังไม่ได้เลือก'}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end">
                <div className="flex flex-col items-end gap-2">
                  <p className={`text-xs ${isDirty ? 'text-amber-700' : 'text-green-700'}`}>
                    {isDirty ? 'ยังไม่บันทึก' : 'บันทึกแล้ว'}
                  </p>
                  <Button onClick={handleSave} disabled={saving}>
                  {saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
                </Button>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                <p className="font-semibold mb-1">สถานะการเชื่อมต่อ</p>
                <p className="text-xs text-gray-500 mb-2">
                  {isDirty ? 'ข้อมูลในฟอร์มยังไม่ได้บันทึก' : 'ข้อมูลล่าสุดจากระบบ'}
                </p>
                <p className="text-xs text-gray-500 mb-2">
                  ในฟอร์มตอนนี้: {localGroupCount} กลุ่ม, {localTokenCount} {provider === 'discord' ? 'webhook' : 'token'}
                </p>
                <p>
                  {provider === 'discord' ? 'Webhook ในกลุ่ม:' : 'Token ในกลุ่ม:'}{' '}
                  <span className={hasAccessToken ? 'text-green-600' : 'text-red-600'}>
                    {hasAccessToken ? 'พร้อม' : 'ยังไม่ตั้งค่า'}
                  </span>
                </p>
                {provider === 'line' ? (
                  <p>
                    Group ID:{' '}
                    <span className={hasGroupId ? 'text-green-600' : 'text-red-600'}>
                      {hasGroupId ? 'พร้อม' : 'ยังไม่ตั้งค่า'}
                    </span>
                  </p>
                ) : null}
                {!configured && (
                  <p className="text-xs text-amber-700 mt-2">
                    ⚠️ ยังไม่สามารถส่งแจ้งเตือนได้จนกว่าจะตั้งค่า {provider === 'discord' ? 'Webhook' : 'Token และ Group ID'}
                  </p>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </Layout>
  );
};
