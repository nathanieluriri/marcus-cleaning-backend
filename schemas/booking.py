# ============================================================================
#BOOKING SCHEMA 
# ============================================================================
# This file was auto-generated on: 2026-02-24 13:24:21 WAT
# It contains Pydantic classes  database
# for managing attributes and validation of data in and out of the MongoDB database.
#
# ============================================================================

from schemas.imports import *
from pydantic import AliasChoices, ConfigDict, Field
import time

class BookingBase(BaseModel):
    # Add other fields here
    customer_id:str
    cleaner_id:str
    extras:Extra
    service: CleaningServices
    duration:Duration
    pass

class BookingCreate(BookingBase):
    # Add other fields here
    
    cleaner_has_accepted: bool = Field(default=False)
    cleaner_acceptance_deadline: int = Field(
        default_factory=lambda: int(time.time() + 10800)  # 3 hours from now
    )
    date_created: int = Field(default_factory=lambda: int(time.time()))
    last_updated: int = Field(default_factory=lambda: int(time.time()))

class BookingUpdate(BaseModel):
    # Add other fields here
    payment_id:Optional[str]=None # TODO: A function would be entering this one to be updated immediately after creation in order for cleaner and customer to know price a payment must be created
    cleaner_has_accepted: Optional[bool] =None # TODO: Seperate route just for acceptance
    cleaner_accepted_at_this_time:int = Field(default_factory=lambda: int(time.time())) # TODO: Seperate route just for acceptance
    cleaner_has_completed: Optional[bool] =None # TODO: Seperate route just for Completion cleaner token_type but inside api/v1/booking
    customer_has_acknowledged_completion: Optional[bool] =None # TODO: Seperate route just for completion customer token_type but inside api/v1/booking
    last_updated: int = Field(default_factory=lambda: int(time.time()))

class BookingOut(BookingBase):
    # Add other fields here
    payment_id:Optional[str]=None 
    cleaner_has_accepted: Optional[bool] =None
    cleaner_has_completed: Optional[bool] =None 
    customer_has_acknowledged_completion: Optional[bool] =None 
    cleaner_accepted_at_this_time:Optional[int]=None
    cleaner_acceptance_deadline:Optional[int]=None
    id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("_id", "id"),
        serialization_alias="id",
    )
    date_created: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("date_created", "dateCreated"),
        serialization_alias="dateCreated",
    )
    last_updated: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("last_updated", "lastUpdated"),
        serialization_alias="lastUpdated",
    )
    
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
