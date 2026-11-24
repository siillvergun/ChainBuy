import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "./auth.js";

/** async 라우트 에러를 에러 핸들러로 넘긴다 */
export const h =
  (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

export const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
  return r.data;
};
