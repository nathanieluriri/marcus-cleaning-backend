from schemas.imports import *
from pydantic import ConfigDict, Field
import time
from security.hash import hash_password


class CleanerSignupRequest(BaseModel):
    firstName: str
    lastName: str
    email: EmailStr
    password: str | bytes

    model_config = {"extra": "forbid"}


class CleanerBase(BaseModel):
    # Add other fields here 
    firstName:str
    lastName:str
    loginType:Optional[LoginType]=None
    email:EmailStr
    password:str | bytes
    accountStatus: AccountStatus = AccountStatus.ACTIVE
    permissionList: Optional[PermissionList] = None
    pass


class CleanerLogin(BaseModel):
    email: EmailStr
    password: str | bytes

    model_config = {"extra": "forbid"}


class CleanerRefresh(BaseModel):
    # Add other fields here 
    refresh_token:str
    pass


class CleanerCreate(CleanerBase):
    # Add other fields here 
    date_created: int = Field(default_factory=lambda: int(time.time()))
    last_updated: int = Field(default_factory=lambda: int(time.time()))
    @model_validator(mode='after')
    def obscure_password(self):
        self.password=hash_password(self.password)
        return self
class CleanerUpdate(BaseModel):
    # Add other fields here 
    last_updated: int = Field(default_factory=lambda: int(time.time()))

class CleanerOut(CleanerBase):
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
