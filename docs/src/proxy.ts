import { i18n } from '@/lib/i18n';
import { createI18nMiddleware } from 'fumadocs-core/i18n/middleware';
import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server';

const handleI18n = createI18nMiddleware(i18n);

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const pathLocale = request.nextUrl.pathname.split('/')[1];
  // 默认英文路径交给 next.config 重写，保持页面还原时的公开路径一致。
  return i18n.languages.some((language) => language === pathLocale) ? handleI18n(request, event) : NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
