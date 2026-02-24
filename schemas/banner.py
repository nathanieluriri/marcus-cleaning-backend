# ============================================================================
#BANNER SCHEMA 
# ============================================================================
# This file was auto-generated on: 2026-02-23 22:11:05 WAT
# It contains Pydantic classes  database
# for managing attributes and validation of data in and out of the MongoDB database.
#
# ============================================================================

from schemas.imports import *
from pydantic import AliasChoices, ConfigDict, Field
import time

class BannerBase(BaseModel):
    image_url:str
    title:str
    description:str
    call_to_action_button_text:str
    purpose:BannerPurpose
    pass

class BannerCreate(BannerBase):
    # Add other fields here 
    date_created: int = Field(default_factory=lambda: int(time.time()))
    last_updated: int = Field(default_factory=lambda: int(time.time()))

class BannerUpdate(BaseModel):
    # Add other fields here
    image_url:Optional[str]=None
    title:Optional[str]=None
    description:Optional[str]=None
    call_to_action_button_text:Optional[str]=None
    purpose:Optional[BannerPurpose]=None 
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class BannerOut(BannerBase):
    # Add other fields here 
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
