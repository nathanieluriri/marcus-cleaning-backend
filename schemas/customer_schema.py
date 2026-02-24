from schemas.imports import *
from pydantic import ConfigDict, Field
import time
from security.hash import hash_password


class CustomerSignupRequest(BaseModel):
    firstName: str
    lastName: str
    email: EmailStr
    password: str | bytes

    model_config = {"extra": "forbid"}


class CustomerBase(BaseModel):
    # Add other fields here 
    firstName:str
    lastName:str
    loginType:LoginType
    email:EmailStr
    password:str | bytes
    accountStatus: AccountStatus = AccountStatus.ACTIVE
    permissionList: Optional[PermissionList] = None
    pass


class CustomerLogin(BaseModel):
    email: EmailStr
    password: str | bytes

    model_config = {"extra": "forbid"}


class CustomerRefresh(BaseModel):
    # Add other fields here 
    refresh_token:str
    pass


class CustomerCreate(CustomerBase):
    # Add other fields here 
    date_created: int = Field(default_factory=lambda: int(time.time()))
    last_updated: int = Field(default_factory=lambda: int(time.time()))
    @model_validator(mode='after')
    def obscure_password(self):
        self.password=hash_password(self.password)
        return self
class CustomerUpdate(BaseModel):
    # Add other fields here 
    last_updated: int = Field(default_factory=lambda: int(time.time()))

class CustomerOut(CustomerBase):
    # Add other fields here 
    id: Optional[str] = Field(default=None, alias="_id")
    date_created: Optional[int] = None
    last_updated: Optional[int] = None
    refresh_token: Optional[str] =None
    access_token:Optional[str]=None
    @model_validator(mode="before")
    @classmethod
    def convert_objectid(cls, values):
        if "_id" in values and isinstance(values["_id"], ObjectId):
            values["_id"] = str(values["_id"])  # coerce to string before validation
        return values
            
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )
