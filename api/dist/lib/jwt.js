import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-development';
if (!JWT_SECRET || JWT_SECRET === 'fallback-secret-for-development') {
    console.warn('Warning: Using fallback JWT_SECRET. Set JWT_SECRET environment variable in production.');
}
export function signToken(payload, expiresIn = '7d') {
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
}
export function verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
}
//# sourceMappingURL=jwt.js.map