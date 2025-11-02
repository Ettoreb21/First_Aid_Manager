const fs = require('fs');
const path = require('path');

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

function unflatten(map) {
  const result = {};
  for (const [key, value] of Object.entries(map || {})) {
    const parts = key.split('.');
    let cur = result;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (i === parts.length - 1) {
        cur[p] = value;
      } else {
        cur[p] = cur[p] || {};
        cur = cur[p];
      }
    }
  }
  return result;
}

class SettingsService {
  constructor(sequelize, SettingModel) {
    this.sequelize = sequelize;
    this.Setting = SettingModel;
    this.cache = new Map();
    this.defaults = {};
    this.defaultsLoaded = false;
  }

  loadDefaults() {
    if (this.defaultsLoaded) return;
    try {
      const file = path.resolve(__dirname, '../config/settings.json');
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.defaults = flatten(data);
      this.defaultsLoaded = true;
    } catch (e) {
      this.defaults = {};
      this.defaultsLoaded = true;
    }
  }

  async initCache() {
    this.loadDefaults();
    try {
      const rows = await this.Setting.findAll();
      this.cache.clear();
      for (const r of rows) {
        let parsed = r.value;
        if (r.type === 'json') {
          try { parsed = JSON.parse(r.value); } catch {}
        } else if (r.type === 'number') {
          parsed = Number(r.value);
        } else if (r.type === 'boolean') {
          parsed = r.value === 'true';
        }
        this.cache.set(r.key, { key: r.key, value: parsed, type: r.type, updatedAt: r.updatedAt });
      }
      // Seed from defaults if empty unless purge lock exists
      const purgeLock = path.resolve(__dirname, '../config/settings.purge.lock');
      const hasPurgeLock = fs.existsSync(purgeLock);
      if (!hasPurgeLock && this.cache.size === 0 && Object.keys(this.defaults).length > 0) {
        const t = await this.sequelize.transaction();
        try {
          for (const [key, value] of Object.entries(this.defaults)) {
            const { type, serialized } = this._serialize(value);
            await this.Setting.upsert({ key, type, value: serialized }, { transaction: t });
            this.cache.set(key, { key, value, type, updatedAt: new Date() });
          }
          await t.commit();
        } catch (e) {
          await t.rollback();
        }
      }
    } catch (e) {
      // DB unavailable: hydrate cache from defaults
      const purgeLock = path.resolve(__dirname, '../config/settings.purge.lock');
      const hasPurgeLock = fs.existsSync(purgeLock);
      this.cache.clear();
      if (!hasPurgeLock) {
        for (const [key, value] of Object.entries(this.defaults)) {
          const { type } = this._serialize(value);
          this.cache.set(key, { key, value, type, updatedAt: new Date() });
        }
      }
    }
  }

  _serialize(value) {
    let type = 'string';
    let serialized = String(value);
    if (typeof value === 'boolean') { type = 'boolean'; serialized = value ? 'true' : 'false'; }
    else if (typeof value === 'number') { type = 'number'; serialized = String(value); }
    else if (typeof value === 'object') { type = 'json'; serialized = JSON.stringify(value); }
    return { type, serialized };
  }

  _deserialize(type, value) {
    if (type === 'boolean') return value === 'true';
    if (type === 'number') return Number(value);
    if (type === 'json') { try { return JSON.parse(value); } catch { return null; } }
    return value;
  }

  getAll() {
    const out = [];
    for (const entry of this.cache.values()) out.push(entry);
    return out;
  }

  get(key) {
    return this.cache.get(key);
  }

  async set(key, value, type) {
    const t = await this.sequelize.transaction();
    try {
      const finalType = type || this._serialize(value).type;
      const serialized = type ? (finalType === 'json' ? JSON.stringify(value) : String(value)) : this._serialize(value).serialized;
      await this.Setting.upsert({ key, type: finalType, value: serialized }, { transaction: t });
      await t.commit();
      const deserialized = finalType === 'json' ? JSON.parse(serialized) : (finalType === 'number' ? Number(serialized) : (finalType === 'boolean' ? serialized === 'true' : serialized));
      const entry = { key, value: deserialized, type: finalType, updatedAt: new Date() };
      this.cache.set(key, entry);
      return entry;
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  async setBulk(items) {
    const t = await this.sequelize.transaction();
    try {
      for (const { key, value, type } of items) {
        const { type: autoType, serialized } = type ? { type, serialized: type === 'json' ? JSON.stringify(value) : String(value) } : this._serialize(value);
        await this.Setting.upsert({ key, type: autoType, value: serialized }, { transaction: t });
        const deserialized = autoType === 'json' ? JSON.parse(serialized) : (autoType === 'number' ? Number(serialized) : (autoType === 'boolean' ? serialized === 'true' : serialized));
        this.cache.set(key, { key, value: deserialized, type: autoType, updatedAt: new Date() });
      }
      await t.commit();
      return this.getAll();
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  export() {
    const flat = {};
    for (const [key, entry] of this.cache.entries()) flat[key] = entry.value;
    return unflatten(flat);
  }

  async import(obj) {
    const flat = flatten(obj);
    const items = Object.entries(flat).map(([key, value]) => ({ key, value }));
    return this.setBulk(items);
  }
}

module.exports = { SettingsService };