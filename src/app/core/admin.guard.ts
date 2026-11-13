import { inject } from '@angular/core';
import { Router } from '@angular/router';
import type { UrlTree, CanActivateFn } from '@angular/router';

import { AuthService } from '../services/auth.service';

// Blocks admin-only pages for residents and sends them to the login screen.
export const adminGuard: CanActivateFn = (): boolean | UrlTree => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAdmin() ? true : router.createUrlTree(['/login']);
};
