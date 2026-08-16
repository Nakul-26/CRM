import { Module } from "@nestjs/common";
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

@Module({
  imports: [SalesModule],
  controllers: [AccountsController, ContactsController, ActivitiesController, TimelineController, SearchController],
  providers: [AccountsService, ContactsService, ActivitiesService, TimelineService, SearchService],
})
export class CrmModule {}
