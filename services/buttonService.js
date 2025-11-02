class ButtonService {
  constructor(sequelize, ButtonStateModel) {
    this.sequelize = sequelize;
    this.ButtonState = ButtonStateModel;
    this.cache = new Map();
  }

  async initCache() {
    if (!this.ButtonState) return;
    try {
      const rows = await this.ButtonState.findAll();
      this.cache.clear();
      for (const r of rows) {
        let parsed = null;
        try { parsed = JSON.parse(r.data); } catch { parsed = null; }
        this.cache.set(r.id, { id: r.id, data: parsed, updatedAt: r.updatedAt });
      }
    } catch (e) {
      // DB non disponibile: lascia cache vuota
    }
  }

  getAll() {
    return Array.from(this.cache.values());
  }

  get(id) {
    return this.cache.get(id) || null;
  }

  async set(id, data) {
    if (!id) throw new Error('Missing button id');
    const serialized = JSON.stringify(data || {});
    const t = this.sequelize ? await this.sequelize.transaction() : null;
    try {
      if (this.ButtonState) {
        await this.ButtonState.upsert({ id, data: serialized }, t ? { transaction: t } : undefined);
      }
      if (t) await t.commit();
      const entry = { id, data: data || {}, updatedAt: new Date() };
      this.cache.set(id, entry);
      return entry;
    } catch (e) {
      if (t) await t.rollback();
      throw e;
    }
  }
}

module.exports = { ButtonService };