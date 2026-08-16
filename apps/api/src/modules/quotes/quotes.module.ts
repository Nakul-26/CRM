import { Module } from "@nestjs/common";
import { ProductsModule } from "../products/products.module";
import { QuotesController } from "./quotes.controller";
import { PublicQuotesController } from "./public-quotes.controller";
import { QuotesService } from "./quotes.service";

@Module({
  imports: [ProductsModule],
  controllers: [QuotesController, PublicQuotesController],
  providers: [QuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}
