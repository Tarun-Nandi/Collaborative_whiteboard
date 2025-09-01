import bcrypt from 'bcryptjs';
const SALT_ROUNDS = 12;
export async function hashPassword(password) {
    return bcrypt.hash(password, SALT_ROUNDS);
}
export async function verifyPassword(password, hashedPassword) {
    return bcrypt.compare(password, hashedPassword);
}
//# sourceMappingURL=password.js.map