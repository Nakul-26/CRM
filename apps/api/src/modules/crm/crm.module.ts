import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@sales-platform/config";
import { SalesModule } from "../sales/sales.module";
import { AccountsService } from "./accounts/accounts.service";
import { AccountsController } from "./accounts/accounts.controller";
import { ContactsService } from "./contacts/contacts.service";
import { ContactsController } from "./contacts/contacts.controller";
import { ActivitiesService } from "./activities/activities.service";
import { ActivitiesController } from "./activities/activities.controller";
import { TimelineService } from "./timeline/timeline.service";
import { TimelineController } from "./timeline/timeline.controller";
import { SearchService } from "./search/search.service";
import { SearchController } from "./search/search.controller";
import { SearchIndexListener } from "./search/search-index.listener";
import { PostgresSearchProvider } from "./search/providers/postgres-search.provider";
import { OpenSearchSearchProvider } from "./search/providers/opensearch-search.provider";
import { SEARCH_PROVIDER, type SearchProvider } from "./search/providers/search-provider.interface";

@Module({
  imports: [SalesModule],
  controllers: [AccountsController, ContactsController, ActivitiesController, TimelineController, SearchController],
  providers: [
    AccountsService,
    ContactsService,
    ActivitiesService,
    TimelineService,
    SearchService,
    SearchIndexListener,
    PostgresSearchProvider,
    OpenSearchSearchProvider,
    {
      provide: SEARCH_PROVIDER,
      useFactory: (
        config: ConfigService<ApiEnv, true>,
        postgres: PostgresSearchProvider,
        opensearch: OpenSearchSearchProvider,
      ): SearchProvider => (config.get("SEARCH_PROVIDER", { infer: true }) === "opensearch" ? opensearch : postgres),
      inject: [ConfigService, PostgresSearchProvider, OpenSearchSearchProvider],
    },
  ],
})
export class CrmModule {}
