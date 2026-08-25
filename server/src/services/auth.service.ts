import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database.js';
import { User, UserRole } from '../types/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'codity-distributed-scheduler-jwt-secret-key-2026';
const JWT_EXPIRES_IN = '7d';

export interface TokenPayload {
  userId: string;
  orgId: string;
  role: UserRole;
  email: string;
  name: string;
}

export class AuthService {
  public static hashPassword(password: string): string {
    return bcrypt.hashSync(password, 10);
  }

  public static comparePassword(password: string, hash: string): boolean {
    return bcrypt.compareSync(password, hash);
  }

  public static generateApiKey(): string {
    return `cds_${uuidv4().replace(/-/g, '')}`;
  }

  public static generateToken(user: User): string {
    const payload: TokenPayload = {
      userId: user.id,
      orgId: user.org_id,
      role: user.role,
      email: user.email,
      name: user.name
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  }

  public static verifyToken(token: string): TokenPayload | null {
    try {
      return jwt.verify(token, JWT_SECRET) as TokenPayload;
    } catch (e) {
      return null;
    }
  }

  public static getUserByApiKey(apiKey: string): User | null {
    return db.queryOne<User>('SELECT * FROM users WHERE api_key = ? AND is_active = 1', [apiKey]);
  }

  public static getUserById(id: string): User | null {
    return db.queryOne<User>('SELECT * FROM users WHERE id = ? AND is_active = 1', [id]);
  }

  public static getUserByEmail(email: string): User | null {
    return db.queryOne<User>('SELECT * FROM users WHERE email = ?', [email]);
  }

  public static register(orgId: string, email: string, password: string, name: string, role: UserRole = 'developer'): { user: User; token: string } {
    const existing = this.getUserByEmail(email);
    if (existing) {
      throw new Error('User with this email already exists');
    }

    const id = uuidv4();
    const password_hash = this.hashPassword(password);
    const api_key = this.generateApiKey();

    db.run(
      `INSERT INTO users (id, org_id, email, password_hash, name, role, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, orgId, email, password_hash, name, role, api_key]
    );

    const user = this.getUserById(id)!;
    const token = this.generateToken(user);
    return { user, token };
  }

  public static login(email: string, password: string): { user: User; token: string } {
    const user = this.getUserByEmail(email);
    if (!user) {
      throw new Error('Invalid email or password');
    }

    if (!user.is_active) {
      throw new Error('Account is deactivated');
    }

    if (!this.comparePassword(password, user.password_hash)) {
      throw new Error('Invalid email or password');
    }

    const token = this.generateToken(user);
    return { user, token };
  }
}
