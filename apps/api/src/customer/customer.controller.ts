import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { UuidParam } from '../infrastructure/http/uuid-param';
import { CreateCustomerUseCase } from './create-customer.use-case';
import {
  CreateCustomerDto,
  CustomerImportResultDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './customer.dto';
import {
  CUSTOMER_IMPORT_FIELD,
  CUSTOMER_IMPORT_MAX_FILE_BYTES,
  CUSTOMER_IMPORT_TEMPLATE_FILENAME,
  XLSX_CONTENT_TYPE,
} from './customer-import.constants';
import { GetCustomerUseCase } from './get-customer.use-case';
import { ImportCustomersUseCase } from './import-customers.use-case';
import { ListCustomersUseCase } from './list-customers.use-case';
import { UpdateCustomerUseCase } from './update-customer.use-case';
import { DeleteCustomerUseCase } from './delete-customer.use-case';
import { buildCustomerImportTemplate } from './parse-customer-excel';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('customers')
export class CustomerController {
  constructor(
    private readonly createCustomer: CreateCustomerUseCase,
    private readonly importCustomers: ImportCustomersUseCase,
    private readonly listCustomers: ListCustomersUseCase,
    private readonly getCustomer: GetCustomerUseCase,
    private readonly updateCustomer: UpdateCustomerUseCase,
    private readonly deleteCustomer: DeleteCustomerUseCase,
  ) {}

  @Get('import/template')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @Header('Content-Type', XLSX_CONTENT_TYPE)
  @Header('Content-Disposition', `attachment; filename="${CUSTOMER_IMPORT_TEMPLATE_FILENAME}"`)
  @ApiOperation({ summary: 'Download the customer Excel import template' })
  async template() {
    const buffer = await buildCustomerImportTemplate();
    return new StreamableFile(buffer, {
      type: XLSX_CONTENT_TYPE,
      disposition: `attachment; filename="${CUSTOMER_IMPORT_TEMPLATE_FILENAME}"`,
    });
  }

  @Post('import')
  @HttpCode(200)
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @UseInterceptors(
    FileInterceptor(CUSTOMER_IMPORT_FIELD, {
      storage: memoryStorage(),
      limits: { fileSize: CUSTOMER_IMPORT_MAX_FILE_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Import salon customers from an Excel .xlsx file' })
  import(
    @CurrentUser() user: AuthenticatedPrincipal,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<CustomerImportResultDto> {
    return this.importCustomers.execute(user, {
      buffer: file?.buffer ?? Buffer.alloc(0),
      originalname: file?.originalname ?? '',
      size: file?.size ?? 0,
    });
  }

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'List or search customers in the authenticated salon' })
  list(@CurrentUser() user: AuthenticatedPrincipal, @Query() query: ListCustomersQueryDto) {
    return this.listCustomers.execute(user, query.q);
  }

  @Post()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Create a customer in the authenticated salon' })
  create(@CurrentUser() user: AuthenticatedPrincipal, @Body() body: CreateCustomerDto) {
    return this.createCustomer.execute(user, body);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Get a customer in the authenticated salon' })
  getById(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', UuidParam) id: string) {
    return this.getCustomer.execute(user, id);
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update a customer in the authenticated salon' })
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', UuidParam) id: string,
    @Body() body: UpdateCustomerDto,
  ) {
    return this.updateCustomer.execute(user, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({
    summary: 'Delete a customer and their completed visit history in the authenticated salon',
  })
  remove(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', UuidParam) id: string) {
    return this.deleteCustomer.execute(user, id);
  }
}
