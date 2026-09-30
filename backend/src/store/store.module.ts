import { Global, Module } from '@nestjs/common';
import { join } from 'node:path';
import { StoreService } from './store.service';
import { DATA_PATH } from './store.tokens';

@Global()
@Module({
  providers: [
    {
      provide: DATA_PATH,
      useFactory: () =>
        process.env.DATA_PATH ?? join(process.cwd(), 'data', 'state.json'),
    },
    StoreService,
  ],
  exports: [StoreService],
})
export class StoreModule {}
