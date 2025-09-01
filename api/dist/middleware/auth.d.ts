import { Request, Response, NextFunction } from 'express';
export interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        email: string;
        name?: string | null;
    };
}
export declare function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=auth.d.ts.map