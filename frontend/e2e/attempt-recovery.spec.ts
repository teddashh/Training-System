import { test } from '@playwright/test';
import { attemptRecoveryTests, examMessageTests } from './learning';

attemptRecoveryTests(test);
examMessageTests(test);
