const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

class AuthService {
  constructor(sequelize, User) {
    this.sequelize = sequelize;
    this.User = User;
  }

  async register({ firstName, lastName, username, email, password, role }) {
    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const user = await this.User.create({
      id,
      firstName,
      lastName,
      username,
      email,
      role,
      passwordHash: hash,
    });
    return user;
  }

  async verifyCredentials(identifier, password) {
    const where = identifier.includes('@') ? { email: identifier } : { username: identifier };
    const user = await this.User.findOne({ where });
    if (!user) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;
    return user;
  }
}

module.exports = { AuthService };