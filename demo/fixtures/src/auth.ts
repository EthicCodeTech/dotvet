import jwt from 'jsonwebtoken';

export function issueToken(payload: object) {
  const token = jwt.sign(payload, process.env.JWT_SECRET);
  return token;
}
