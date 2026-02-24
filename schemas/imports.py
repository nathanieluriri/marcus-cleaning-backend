from bson import ObjectId
from pydantic import GetJsonSchemaHandler
from pydantic import BaseModel, EmailStr, Field,model_validator
from pydantic_core import core_schema
from datetime import datetime,timezone
from typing import Optional,List,Any
from enum import Enum
import time



class AddOn(str,Enum):
    LAUNDRY="LAUNDRY"
    INSIDE_FRIDGE="INSIDE_FRIDGE"
    WINDOWS="WINDOWS"
    CABINETS="CABINETS"
    
class Extra(BaseModel):
    add_ons: List[AddOn] = []

class LoginType(str, Enum):
    google = "GOOGLE"
    email = "EMAIL"

class AccountStatus(str, Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    SUSPENDED = "SUSPENDED"
    
    
    
class CleaningServices(str, Enum):
    STANDARD = "STANDARD"
    OFFICE = "OFFICE"
    CUSTOM="CUSTOM"
    DEEP_CLEAN = "DEEP_CLEAN"
    
class Duration(BaseModel):
    hours: int = Field(..., ge=0)
    minutes: int = Field(..., ge=0, le=59)

    def to_hours(self) -> float:
        return self.hours + self.minutes / 60
    
class BannerPurpose(str, Enum):
    Rewards = "REWARDS"
    Invitation = "INVITATION"
    Discount = "DISCOUNT"


class Permission(BaseModel):
    name: str
    methods: List[str]
    path: str
    key: Optional[str] = None
    description: Optional[str] = None

class PermissionList(BaseModel):
    permissions: List[Permission]
